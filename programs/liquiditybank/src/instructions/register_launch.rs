use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::LiquidityBankError;
use crate::state::{LaunchConfig, ProtocolConfig};

#[derive(Accounts)]
pub struct RegisterLaunch<'info> {
    /// The wallet paying the launch fee. Has no on-chain authority post-registration.
    #[account(mut)]
    pub registrant: Signer<'info>,

    /// The pump.fun token mint. Must already be created on pump.fun with
    /// `fee_owner` (derived below) as the creator role. The frontend handles
    /// the pump.fun create tx separately before calling this instruction.
    pub mint: InterfaceAccount<'info, Mint>,

    /// Per-launch authority PDA. Will be the pump.fun creator and the
    /// SOL/WSOL custodian for this launch.
    /// CHECK: bare PDA, no data lives here. Only seeds are validated.
    #[account(
        seeds = [b"fee-owner", mint.key().as_ref()],
        bump,
    )]
    pub fee_owner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = registrant,
        space = 8 + LaunchConfig::INIT_SPACE,
        seeds = [b"launch-config", mint.key().as_ref()],
        bump,
    )]
    pub launch_config: Account<'info, LaunchConfig>,

    #[account(
        mut,
        seeds = [b"protocol-config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: lamport sink for the launch fee.
    #[account(
        mut,
        seeds = [b"protocol-revenue"],
        bump,
    )]
    pub protocol_revenue: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_launch(ctx: Context<RegisterLaunch>) -> Result<()> {
    require!(!ctx.accounts.protocol_config.paused, LiquidityBankError::AlreadyFulfilled);

    // Pay the launch fee into the protocol revenue PDA.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.registrant.to_account_info(),
            to: ctx.accounts.protocol_revenue.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, LAUNCH_FEE_LAMPORTS)?;

    // Persist LaunchConfig.
    let cfg = &mut ctx.accounts.launch_config;
    cfg.mint = ctx.accounts.mint.key();
    cfg.registrant = ctx.accounts.registrant.key();
    cfg.bump = ctx.bumps.launch_config;
    cfg.fee_owner_bump = ctx.bumps.fee_owner;
    cfg.cumulative_fees_collected = 0;
    cfg.cumulative_lp_sol_added = 0;
    cfg.cumulative_lp_burned = 0;
    cfg.cumulative_curve_sol_spent = 0;
    cfg.cumulative_tokens_burned = 0;
    cfg.crank_count = 0;
    cfg.curve_burn_count = 0;
    cfg.created_at = Clock::get()?.unix_timestamp;

    // Update protocol counters.
    let proto = &mut ctx.accounts.protocol_config;
    proto.total_launches = proto
        .total_launches
        .checked_add(1)
        .ok_or(LiquidityBankError::MathOverflow)?;
    proto.total_revenue_lamports = proto
        .total_revenue_lamports
        .checked_add(LAUNCH_FEE_LAMPORTS)
        .ok_or(LiquidityBankError::MathOverflow)?;

    msg!("liquidity-bank: account opened mint={}", ctx.accounts.mint.key());

    Ok(())
}
