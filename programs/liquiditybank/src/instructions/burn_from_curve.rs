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
// burn_from_curve (router CPI)
// =============================================================================
//
// Pre-graduation cycle. Spends fee_owner's accumulated SOL on a buy of its
// own token via an arbitrary router program (typically Jupiter v6), then
// BURNS the received tokens — a real on-chain supply reduction.
//
// The off-chain caller fetches a swap instruction from the router (e.g.
// Jupiter's /swap-instructions endpoint with userPublicKey=fee_owner), then
// passes the instruction's data + account list + per-account signer/writable
// flags here. This program forwards everything to the router with fee_owner
// signing via invoke_signed.
//
// Flow:
//   1. Wrap fee_owner's spendable bare SOL into fee_owner's WSOL ATA
//      (system_program::transfer + spl_token::sync_native).
//   2. CPI the router program with the supplied data + remaining_accounts,
//      with fee_owner as the PDA signer. Router does the swap and lands the
//      base tokens in fee_owner's base-token ATA.
//   3. SPL Token Burn from fee_owner's ATA — decrements mint.supply.
//   4. Pay CRANK_REWARD_LAMPORTS to the cranker.
//
// Why this generic shape: pump.fun has been rewriting their direct-call ABI
// frequently (legacy buy → buy_v2 → who knows what next). Routing through
// Jupiter delegates ABI tracking to them. The same program also works post
// graduation when the token migrates to PumpSwap, without another upgrade.

#[derive(Accounts)]
pub struct BurnFromCurve<'info> {
    /// Must be the protocol keeper. This crank signs as `fee_owner` and forwards
    /// caller-controlled router data, so it cannot be permissionless without
    /// handing anyone the ability to drain the vault via slippage.
    #[account(mut, address = KEEPER_AUTHORITY @ LiquidityBankError::UnauthorizedKeeper)]
    pub cranker: Signer<'info>,

    /// Token mint — writable because SPL Burn decrements `mint.supply`.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"launch-config", mint.key().as_ref()],
        bump = launch_config.bump,
        has_one = mint,
    )]
    pub launch_config: Account<'info, LaunchConfig>,

    /// Per-launch authority PDA. Signs the wrap, the router CPI, the SPL
    /// burn from its own token ATA, and the crank-reward payout.
    /// CHECK: PDA, seeds + bump verified.
    #[account(
        mut,
        seeds = [b"fee-owner", mint.key().as_ref()],
        bump = launch_config.fee_owner_bump,
    )]
    pub fee_owner: UncheckedAccount<'info>,

    /// fee_owner's base-token ATA. Tokens land here from the swap, then are
    /// burned via SPL Token's Burn ix (mint.supply decreases).
    #[account(mut)]
    pub fee_owner_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// fee_owner's WSOL ATA. Pre-created by the cranker before this call.
    /// Receives wrapped SOL pre-swap; drained by the router CPI.
    /// CHECK: canonical WSOL ATA of fee_owner, verified by derivation.
    #[account(mut)]
    pub fee_owner_wsol_ata: UncheckedAccount<'info>,

    /// CHECK: WSOL mint, verified by address.
    #[account(address = NATIVE_MINT_ID)]
    pub quote_mint: UncheckedAccount<'info>,

    /// The external router program (Jupiter v6, PumpSwap router, etc.).
    /// CHECK: caller-supplied router; bytecode is whatever it is. The router
    /// is responsible for its own validation. We only sign for fee_owner.
    pub router_program: UncheckedAccount<'info>,

    /// CHECK: SPL token program (for wrap + transfer-to-incinerator).
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn burn_from_curve<'info>(
    ctx: Context<'_, '_, 'info, 'info, BurnFromCurve<'info>>,
    router_data: Vec<u8>,
    router_account_flags: Vec<u8>,
    min_tokens_out: u64,
) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let fee_owner_bump = ctx.accounts.launch_config.fee_owner_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"fee-owner", mint_key.as_ref(), &[fee_owner_bump]]];

    // ------------------------------------------------------------------
    // Router must be on the allowlist. The CPI below runs with fee_owner's
    // signature; an arbitrary program could simply transfer the WSOL out.
    // ------------------------------------------------------------------
    require!(
        ALLOWED_ROUTER_PROGRAMS.contains(&ctx.accounts.router_program.key()),
        LiquidityBankError::DisallowedRouter
    );

    // ------------------------------------------------------------------
    // Validate WSOL ATA derivation.
    // ------------------------------------------------------------------
    let expected_fee_owner_wsol_ata =
        get_associated_token_address(&ctx.accounts.fee_owner.key(), &NATIVE_MINT_ID);
    require_keys_eq!(
        ctx.accounts.fee_owner_wsol_ata.key(),
        expected_fee_owner_wsol_ata,
        LiquidityBankError::InvalidPumpAccount
    );

    // Caller's flags array must be 1:1 with remaining_accounts.
    require_eq!(
        router_account_flags.len(),
        ctx.remaining_accounts.len(),
        LiquidityBankError::InvalidPumpAccount
    );

    // ------------------------------------------------------------------
    // 1. Compute spendable SOL.
    // ------------------------------------------------------------------
    let fee_owner_balance = ctx.accounts.fee_owner.lamports();
    let total_reserve = FEE_OWNER_RESERVE_LAMPORTS
        .checked_add(CRANK_REWARD_LAMPORTS)
        .ok_or(LiquidityBankError::MathOverflow)?;
    require!(
        fee_owner_balance >= CRANK_THRESHOLD_LAMPORTS,
        LiquidityBankError::BelowCrankThreshold
    );
    let spend = fee_owner_balance
        .checked_sub(total_reserve)
        .ok_or(LiquidityBankError::MathOverflow)?;

    // ------------------------------------------------------------------
    // 2. Wrap `spend` bare lamports → fee_owner's WSOL ATA + sync_native.
    // ------------------------------------------------------------------
    {
        let ix = system_instruction::transfer(
            &ctx.accounts.fee_owner.key(),
            &ctx.accounts.fee_owner_wsol_ata.key(),
            spend,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.fee_owner.to_account_info(),
                ctx.accounts.fee_owner_wsol_ata.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
    }
    {
        let ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![AccountMeta::new(
                ctx.accounts.fee_owner_wsol_ata.key(),
                false,
            )],
            data: vec![SPL_TOKEN_SYNC_NATIVE_IX],
        };
        invoke_signed(
            &ix,
            &[ctx.accounts.fee_owner_wsol_ata.to_account_info()],
            signer_seeds,
        )?;
    }

    // ------------------------------------------------------------------
    // 3. Build + invoke the router CPI.
    //    For each remaining_account: flag byte bit0 = is_writable,
    //    bit1 = is_signer. Only fee_owner is allowed to be a signer; any
    //    other "signer" account would be a security risk if the caller
    //    can trick us into signing for arbitrary PDAs we don't own.
    // ------------------------------------------------------------------
    let fee_owner_key = ctx.accounts.fee_owner.key();
    let metas: Vec<AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .zip(router_account_flags.iter())
        .map(|(acct, &flag)| {
            let is_writable = (flag & 0b01) != 0;
            let mut is_signer = (flag & 0b10) != 0;
            // Defensive: only sign for fee_owner. If caller marks any other
            // account as signer, ignore the bit.
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

    let token_balance_before = ctx.accounts.fee_owner_token_ata.amount;

    {
        let ix = Instruction {
            program_id: ctx.accounts.router_program.key(),
            accounts: metas,
            data: router_data,
        };
        let infos: Vec<AccountInfo> =
            ctx.remaining_accounts.iter().cloned().collect();
        invoke_signed(&ix, &infos, signer_seeds)?;
    }

    // ------------------------------------------------------------------
    // 4. Compute tokens bought, burn via SPL Token Burn ix.
    //    Burn decrements both the ATA balance AND mint.supply — a real
    //    supply reduction, not just sending to an unspendable address.
    //    Permissioned by the ATA owner (fee_owner), not the mint authority.
    // ------------------------------------------------------------------
    ctx.accounts.fee_owner_token_ata.reload()?;
    let token_balance_after = ctx.accounts.fee_owner_token_ata.amount;
    let tokens_bought = token_balance_after
        .checked_sub(token_balance_before)
        .ok_or(LiquidityBankError::MathOverflow)?;

    require!(
        tokens_bought >= min_tokens_out,
        LiquidityBankError::SlippageExceeded
    );
    require!(tokens_bought > 0, LiquidityBankError::SlippageExceeded);

    {
        let mut data = Vec::with_capacity(9);
        data.push(SPL_TOKEN_BURN_IX);
        data.extend_from_slice(&tokens_bought.to_le_bytes());

        let ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.fee_owner_token_ata.key(), false),
                AccountMeta::new(ctx.accounts.mint.key(), false),
                AccountMeta::new_readonly(ctx.accounts.fee_owner.key(), true),
            ],
            data,
        };
        invoke_signed(
            &ix,
            &[
                ctx.accounts.fee_owner_token_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
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
            &ctx.accounts.fee_owner.key(),
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
    cfg.cumulative_curve_sol_spent = cfg
        .cumulative_curve_sol_spent
        .checked_add(spend)
        .ok_or(LiquidityBankError::MathOverflow)?;
    cfg.cumulative_tokens_burned = cfg
        .cumulative_tokens_burned
        .checked_add(tokens_bought)
        .ok_or(LiquidityBankError::MathOverflow)?;
    cfg.curve_burn_count = cfg
        .curve_burn_count
        .checked_add(1)
        .ok_or(LiquidityBankError::MathOverflow)?;

    msg!(
        "liquidity-bank: router burn sol_spent={} tokens_burned={}",
        spend,
        tokens_bought,
    );

    Ok(())
}
