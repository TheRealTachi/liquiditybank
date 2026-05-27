use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

use crate::errors::LiquidityBankError;
use crate::state::ProtocolConfig;

// =============================================================================
// admin_collect_revenue
// =============================================================================
//
// The protocol's launch-fee revenue accrues in the `protocol_revenue` PDA
// (one 0.02 SOL deposit per register_launch). This instruction lets the
// protocol admin pull a specified amount out to any destination wallet.
//
// IMPORTANT: this is the ONLY instruction in the entire program that moves
// value to a human-controlled address — and even then, only the admin
// recorded in protocol_config can call it, and only from the protocol's
// own revenue PDA (never from a launch's fee_owner vault, which has no
// withdraw path of any kind).
//
// This does NOT touch any individual launch's fee_owner. Those vaults are
// permanently isolated from human withdrawal.

#[derive(Accounts)]
pub struct AdminCollectRevenue<'info> {
    /// Must match `protocol_config.admin` — enforced by `has_one`.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"protocol-config"],
        bump = protocol_config.bump,
        has_one = admin,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: lamport sink, system-owned. Verified by seeds.
    #[account(
        mut,
        seeds = [b"protocol-revenue"],
        bump,
    )]
    pub protocol_revenue: UncheckedAccount<'info>,

    /// CHECK: arbitrary destination, lamports go here.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn admin_collect_revenue(
    ctx: Context<AdminCollectRevenue>,
    lamports: u64,
) -> Result<()> {
    let balance = ctx.accounts.protocol_revenue.lamports();
    require!(balance >= lamports, LiquidityBankError::MathOverflow);

    let revenue_bump = ctx.bumps.protocol_revenue;
    let signer_seeds: &[&[&[u8]]] = &[&[b"protocol-revenue", &[revenue_bump]]];

    let ix = system_instruction::transfer(
        &ctx.accounts.protocol_revenue.key(),
        &ctx.accounts.destination.key(),
        lamports,
    );

    invoke_signed(
        &ix,
        &[
            ctx.accounts.protocol_revenue.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "liquidity-bank: revenue collected lamports={} to={}",
        lamports,
        ctx.accounts.destination.key(),
    );

    Ok(())
}
