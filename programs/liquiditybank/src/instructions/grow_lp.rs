use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::*;
use crate::errors::LiquidityBankError;
use crate::state::LaunchConfig;

// =============================================================================
// grow_lp (router CPI, post-graduation)
// =============================================================================
//
// Permissionless crank used after the token has graduated from pump.fun's
// bonding curve to a PumpSwap AMM pool.
//
// Two CPIs in sequence, both with fee_owner as the PDA signer:
//   1. SWAP router CPI: spends HALF of fee_owner's WSOL for tokens (typically
//      Jupiter v6 → routes through PumpSwap automatically). Caller supplies
//      the router program, ix data, and route accounts.
//   2. DEPOSIT router CPI: deposits the remaining WSOL + bought tokens as
//      paired LP into the pool (caller supplies the PumpSwap deposit ix from
//      the current PumpSwap SDK).
//
// Then:
//   3. SPL Token Burn on the LP mint — decrements lp_mint.supply. Real burn,
//      not transfer-to-incinerator. The LP shares are gone forever.
//   4. Pay CRANK_REWARD_LAMPORTS to the cranker.
//
// remaining_accounts layout:
//   - First `swap_account_count` accounts:    SWAP router's accounts
//   - Remainder:                              DEPOSIT router's accounts
//
// flags arrays (one byte each, bit0 = is_writable, bit1 = is_signer):
//   - swap_account_flags.len()    == swap_account_count
//   - deposit_account_flags.len() == remaining_accounts.len() - swap_account_count
//
// Only fee_owner is allowed to be a signer via these flags; any other "signer"
// flag is stripped defensively.
//
// Why generic: PumpSwap's ABI drifts (the static account layout from the
// staked reference repo is already stale). By accepting arbitrary router ixs,
// we let the off-chain caller construct the correct shape using current
// PumpSwap / Jupiter SDKs without needing on-chain updates.

#[derive(Accounts)]
pub struct GrowLp<'info> {
    /// Must be the protocol keeper. This crank signs as `fee_owner` and forwards
    /// caller-controlled router data, so it cannot be permissionless without
    /// handing anyone the ability to drain the vault via slippage.
    #[account(mut, address = KEEPER_AUTHORITY @ LiquidityBankError::UnauthorizedKeeper)]
    pub cranker: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"launch-config", mint.key().as_ref()],
        bump = launch_config.bump,
        has_one = mint,
    )]
    pub launch_config: Account<'info, LaunchConfig>,

    /// Per-launch authority PDA. Signs the swap, the deposit, the LP burn,
    /// and the crank-reward payout.
    /// CHECK: PDA, seeds + bump verified.
    #[account(
        mut,
        seeds = [b"fee-owner", mint.key().as_ref()],
        bump = launch_config.fee_owner_bump,
    )]
    pub fee_owner: UncheckedAccount<'info>,

    /// fee_owner's base-token ATA. Receives tokens from the swap, drained
    /// to the pool by the deposit.
    #[account(mut)]
    pub fee_owner_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// fee_owner's WSOL ATA. Source of WSOL for both the swap and the
    /// deposit-quote leg. Caller is responsible for wrapping bare SOL into
    /// this ATA before invoking (e.g., a SystemProgram transfer +
    /// sync_native in the same tx or a prior tx).
    /// CHECK: canonical WSOL ATA of fee_owner.
    #[account(mut)]
    pub fee_owner_wsol_ata: UncheckedAccount<'info>,

    /// fee_owner's LP-token ATA. Receives LP shares from the deposit, then
    /// burned via SPL Token Burn (decrements lp_mint.supply).
    #[account(mut)]
    pub fee_owner_lp_ata: InterfaceAccount<'info, TokenAccount>,

    /// LP token mint. Writable because SPL Burn decrements supply.
    /// CHECK: caller-supplied; SPL Burn validates token-program ownership.
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,

    /// Router program used for the swap step (typically Jupiter v6).
    /// CHECK: caller-supplied program id.
    pub swap_router_program: UncheckedAccount<'info>,

    /// Router program used for the deposit step (typically PumpSwap AMM).
    /// CHECK: caller-supplied program id.
    pub deposit_router_program: UncheckedAccount<'info>,

    /// CHECK: SPL token program (legacy) — used for the LP burn.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn grow_lp<'info>(
    ctx: Context<'_, '_, 'info, 'info, GrowLp<'info>>,
    swap_data: Vec<u8>,
    swap_account_flags: Vec<u8>,
    deposit_data: Vec<u8>,
    deposit_account_flags: Vec<u8>,
    min_tokens_out_from_swap: u64,
    min_lp_out: u64,
) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let fee_owner_bump = ctx.accounts.launch_config.fee_owner_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"fee-owner", mint_key.as_ref(), &[fee_owner_bump]]];
    let fee_owner_key = ctx.accounts.fee_owner.key();

    // ------------------------------------------------------------------
    // Both routers must be on the allowlist. Each CPI below runs with
    // fee_owner's signature; an arbitrary program could transfer funds out.
    // ------------------------------------------------------------------
    require!(
        ALLOWED_ROUTER_PROGRAMS.contains(&ctx.accounts.swap_router_program.key()),
        LiquidityBankError::DisallowedRouter
    );
    require!(
        ALLOWED_ROUTER_PROGRAMS.contains(&ctx.accounts.deposit_router_program.key()),
        LiquidityBankError::DisallowedRouter
    );

    // ------------------------------------------------------------------
    // Validate WSOL ATA derivation.
    // ------------------------------------------------------------------
    let expected_fee_owner_wsol_ata =
        get_associated_token_address(&fee_owner_key, &NATIVE_MINT_ID);
    require_keys_eq!(
        ctx.accounts.fee_owner_wsol_ata.key(),
        expected_fee_owner_wsol_ata,
        LiquidityBankError::InvalidPumpAccount
    );

    // Flags arrays must partition remaining_accounts exactly.
    let swap_n = swap_account_flags.len();
    let deposit_n = deposit_account_flags.len();
    require_eq!(
        swap_n.checked_add(deposit_n).ok_or(LiquidityBankError::MathOverflow)?,
        ctx.remaining_accounts.len(),
        LiquidityBankError::InvalidPumpAccount
    );

    // ------------------------------------------------------------------
    // 1. Threshold check on fee_owner's bare lamports — we expect the
    //    caller to have wrapped enough into WSOL upstream.
    //    (Caller may also keep some bare lamports as the cranker reward
    //    reserve. We enforce only the WSOL side here since both swap and
    //    deposit consume WSOL, not bare SOL.)
    // ------------------------------------------------------------------
    let fee_owner_balance = ctx.accounts.fee_owner.lamports();
    require!(
        fee_owner_balance
            >= FEE_OWNER_RESERVE_LAMPORTS
                .checked_add(CRANK_REWARD_LAMPORTS)
                .ok_or(LiquidityBankError::MathOverflow)?,
        LiquidityBankError::BelowCrankThreshold
    );

    // ------------------------------------------------------------------
    // 2. CPI the swap router with the first `swap_n` of remaining_accounts.
    // ------------------------------------------------------------------
    let swap_accts = &ctx.remaining_accounts[..swap_n];
    let deposit_accts = &ctx.remaining_accounts[swap_n..];

    let token_balance_before = ctx.accounts.fee_owner_token_ata.amount;
    let lp_balance_before = ctx.accounts.fee_owner_lp_ata.amount;

    {
        let metas: Vec<AccountMeta> = swap_accts
            .iter()
            .zip(swap_account_flags.iter())
            .map(|(acct, &flag)| {
                let is_writable = (flag & 0b01) != 0;
                let mut is_signer = (flag & 0b10) != 0;
                if is_signer && *acct.key != fee_owner_key {
                    is_signer = false;
                }
                AccountMeta {
                    pubkey: *acct.key,
                    is_signer,
                    is_writable,
                }
            })
            .collect();

        let ix = Instruction {
            program_id: ctx.accounts.swap_router_program.key(),
            accounts: metas,
            data: swap_data,
        };
        let infos: Vec<AccountInfo> = swap_accts.iter().cloned().collect();
        invoke_signed(&ix, &infos, signer_seeds)?;
    }

    ctx.accounts.fee_owner_token_ata.reload()?;
    let tokens_bought = ctx
        .accounts
        .fee_owner_token_ata
        .amount
        .checked_sub(token_balance_before)
        .ok_or(LiquidityBankError::MathOverflow)?;
    require!(
        tokens_bought >= min_tokens_out_from_swap,
        LiquidityBankError::SlippageExceeded
    );

    // ------------------------------------------------------------------
    // 3. CPI the deposit router with the remaining accounts. The caller
    //    pre-computed the deposit amounts based on pool ratios.
    // ------------------------------------------------------------------
    {
        let metas: Vec<AccountMeta> = deposit_accts
            .iter()
            .zip(deposit_account_flags.iter())
            .map(|(acct, &flag)| {
                let is_writable = (flag & 0b01) != 0;
                let mut is_signer = (flag & 0b10) != 0;
                if is_signer && *acct.key != fee_owner_key {
                    is_signer = false;
                }
                AccountMeta {
                    pubkey: *acct.key,
                    is_signer,
                    is_writable,
                }
            })
            .collect();

        let ix = Instruction {
            program_id: ctx.accounts.deposit_router_program.key(),
            accounts: metas,
            data: deposit_data,
        };
        let infos: Vec<AccountInfo> = deposit_accts.iter().cloned().collect();
        invoke_signed(&ix, &infos, signer_seeds)?;
    }

    ctx.accounts.fee_owner_lp_ata.reload()?;
    let lp_received = ctx
        .accounts
        .fee_owner_lp_ata
        .amount
        .checked_sub(lp_balance_before)
        .ok_or(LiquidityBankError::MathOverflow)?;
    require!(lp_received >= min_lp_out, LiquidityBankError::SlippageExceeded);
    require!(lp_received > 0, LiquidityBankError::SlippageExceeded);

    // ------------------------------------------------------------------
    // 4. SPL Token Burn the received LP shares. Decrements lp_mint.supply.
    // ------------------------------------------------------------------
    {
        let mut data = Vec::with_capacity(9);
        data.push(SPL_TOKEN_BURN_IX);
        data.extend_from_slice(&lp_received.to_le_bytes());

        let ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.fee_owner_lp_ata.key(), false),
                AccountMeta::new(ctx.accounts.lp_mint.key(), false),
                AccountMeta::new_readonly(fee_owner_key, true),
            ],
            data,
        };
        invoke_signed(
            &ix,
            &[
                ctx.accounts.fee_owner_lp_ata.to_account_info(),
                ctx.accounts.lp_mint.to_account_info(),
                ctx.accounts.fee_owner.to_account_info(),
            ],
            signer_seeds,
        )?;
    }

    // ------------------------------------------------------------------
    // 5. Pay the cranker.
    // ------------------------------------------------------------------
    {
        let ix = system_instruction::transfer(
            &fee_owner_key,
            &ctx.accounts.cranker.key(),
            CRANK_REWARD_LAMPORTS,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.fee_owner.to_account_info(),
                ctx.accounts.cranker.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
    }

    // ------------------------------------------------------------------
    // 6. Update counters.
    // ------------------------------------------------------------------
    let cfg = &mut ctx.accounts.launch_config;
    cfg.cumulative_lp_burned = cfg
        .cumulative_lp_burned
        .checked_add(lp_received)
        .ok_or(LiquidityBankError::MathOverflow)?;
    cfg.crank_count = cfg
        .crank_count
        .checked_add(1)
        .ok_or(LiquidityBankError::MathOverflow)?;

    msg!(
        "liquidity-bank: grow_lp tokens_bought={} lp_burned={}",
        tokens_bought,
        lp_received,
    );

    Ok(())
}
