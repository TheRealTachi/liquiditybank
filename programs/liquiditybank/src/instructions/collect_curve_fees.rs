use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::LiquidityBankError;
use crate::state::LaunchConfig;

/// Pulls SOL creator fees out of the pump.fun bonding curve into our
/// fee_owner PDA. Permissionless: anyone can crank it.
///
/// CPI shape mirrors iceypump/staked::fees::claim_pump_creator_fees
/// (the legacy `collect_creator_fee` discriminator, accounts in order:
///  fee_owner (signer), creator_vault, system, pump_event_authority, pump_program).
#[derive(Accounts)]
pub struct CollectCurveFees<'info> {
    /// The cranker — receives the crank reward.
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

    /// Per-launch authority. Will SIGN the pump.fun CPI as the creator.
    /// CHECK: PDA, seeds + bump verified.
    #[account(
        mut,
        seeds = [b"fee-owner", mint.key().as_ref()],
        bump = launch_config.fee_owner_bump,
    )]
    pub fee_owner: UncheckedAccount<'info>,

    /// Pump.fun's creator-vault PDA for our fee_owner.
    /// CHECK: validated by pump.fun program at CPI time.
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,

    /// CHECK: pump.fun event authority PDA.
    pub pump_event_authority: UncheckedAccount<'info>,

    /// CHECK: pump.fun program.
    #[account(address = PUMP_PROGRAM_ID)]
    pub pump_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn collect_curve_fees(ctx: Context<CollectCurveFees>) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let fee_owner_bump = ctx.accounts.launch_config.fee_owner_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"fee-owner", mint_key.as_ref(), &[fee_owner_bump]]];

    let balance_before = ctx.accounts.fee_owner.lamports();

    let ix = Instruction {
        program_id: PUMP_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.fee_owner.key(), true),
            AccountMeta::new(ctx.accounts.creator_vault.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_program.key(), false),
        ],
        data: PUMP_COLLECT_CREATOR_FEE_IX.to_vec(),
    };

    invoke_signed(
        &ix,
        &[
            ctx.accounts.fee_owner.to_account_info(),
            ctx.accounts.creator_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.pump_event_authority.to_account_info(),
            ctx.accounts.pump_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    let balance_after = ctx.accounts.fee_owner.lamports();
    let collected = balance_after.saturating_sub(balance_before);

    let cfg = &mut ctx.accounts.launch_config;
    cfg.cumulative_fees_collected = cfg
        .cumulative_fees_collected
        .checked_add(collected)
        .ok_or(LiquidityBankError::MathOverflow)?;

    msg!("liquidity-bank: deposited curve fees lamports={}", collected);

    Ok(())
}
