use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::LiquidityBankError;
use crate::state::LaunchConfig;

/// Pulls WSOL creator fees out of the PumpSwap (post-graduation) pool's
/// coin_creator vault into our fee_owner's WSOL ATA.
///
/// CPI shape mirrors iceypump/staked::fees::claim_pumpswap_quote_creator_fees
/// (the `collect_coin_creator_fee` discriminator, accounts in the order
/// the staked repo uses).
#[derive(Accounts)]
pub struct CollectAmmFees<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"launch-config", mint.key().as_ref()],
        bump = launch_config.bump,
        has_one = mint,
    )]
    pub launch_config: Account<'info, LaunchConfig>,

    /// CHECK: WSOL native mint.
    #[account(address = NATIVE_MINT_ID)]
    pub quote_mint: UncheckedAccount<'info>,

    /// CHECK: legacy SPL token program — pumpswap quote uses WSOL on legacy SPL.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub quote_token_program: UncheckedAccount<'info>,

    /// CHECK: per-launch fee_owner PDA, not a signer here (read-only on this CPI).
    #[account(
        seeds = [b"fee-owner", mint.key().as_ref()],
        bump = launch_config.fee_owner_bump,
    )]
    pub fee_owner: UncheckedAccount<'info>,

    /// CHECK: pumpswap `creator_vault` authority PDA for our fee_owner.
    pub coin_creator_vault_authority: UncheckedAccount<'info>,

    /// CHECK: pumpswap's WSOL ATA holding accumulated creator fees.
    #[account(mut)]
    pub coin_creator_vault_ata: UncheckedAccount<'info>,

    /// CHECK: fee_owner's WSOL ATA. Will receive the collected WSOL.
    #[account(mut)]
    pub fee_owner_wsol_ata: UncheckedAccount<'info>,

    /// CHECK: pumpswap event authority PDA.
    pub pump_amm_event_authority: UncheckedAccount<'info>,

    /// CHECK: pumpswap program.
    #[account(address = PUMP_AMM_PROGRAM_ID)]
    pub pump_amm_program: UncheckedAccount<'info>,
}

pub fn collect_amm_fees(ctx: Context<CollectAmmFees>) -> Result<()> {
    let balance_before = ctx.accounts.fee_owner_wsol_ata.lamports();

    let ix = Instruction {
        program_id: PUMP_AMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.quote_mint.key(), false),
            AccountMeta::new_readonly(ctx.accounts.quote_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.fee_owner.key(), false),
            AccountMeta::new_readonly(ctx.accounts.coin_creator_vault_authority.key(), false),
            AccountMeta::new(ctx.accounts.coin_creator_vault_ata.key(), false),
            AccountMeta::new(ctx.accounts.fee_owner_wsol_ata.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_amm_event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_amm_program.key(), false),
        ],
        data: PUMP_AMM_COLLECT_COIN_CREATOR_FEE_IX.to_vec(),
    };

    // pumpswap collect_coin_creator_fee is a permissionless poke based on
    // the vault authority — fee_owner does not sign.
    invoke(
        &ix,
        &[
            ctx.accounts.quote_mint.to_account_info(),
            ctx.accounts.quote_token_program.to_account_info(),
            ctx.accounts.fee_owner.to_account_info(),
            ctx.accounts.coin_creator_vault_authority.to_account_info(),
            ctx.accounts.coin_creator_vault_ata.to_account_info(),
            ctx.accounts.fee_owner_wsol_ata.to_account_info(),
            ctx.accounts.pump_amm_event_authority.to_account_info(),
            ctx.accounts.pump_amm_program.to_account_info(),
        ],
    )?;

    let balance_after = ctx.accounts.fee_owner_wsol_ata.lamports();
    let collected = balance_after.saturating_sub(balance_before);

    let cfg = &mut ctx.accounts.launch_config;
    cfg.cumulative_fees_collected = cfg
        .cumulative_fees_collected
        .checked_add(collected)
        .ok_or(LiquidityBankError::MathOverflow)?;

    msg!("liquidity-bank: deposited amm fees lamports={}", collected);

    Ok(())
}
