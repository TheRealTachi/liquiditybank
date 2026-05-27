//! liquiditybank — self-deepening permanent liquidity for pump.fun launches.
//!
//! Every pump.fun creator fee SOL routed into our `fee_owner` PDA gets used
//! to BUY tokens, paired into LP, and BURNED. Pool depth grows monotonically
//! with trading activity. No one — including the protocol admin — can pull
//! the LP. Eventually the program's upgrade authority will be renounced,
//! making the entire instruction set the totality of what can ever happen.
//!
//! Instructions:
//!   - initialize_protocol  : one-time admin setup (revenue PDA, paused flag)
//!   - register_launch      : wire a pump.fun mint into the program (0.02 SOL fee)
//!   - collect_curve_fees   : permissionless crank, pulls SOL from pump.fun curve
//!   - collect_amm_fees     : permissionless crank, pulls WSOL from PumpSwap pool
//!   - burn_from_curve      : pre-graduation crank, buys tokens from curve + burns
//!   - grow_lp              : post-graduation crank, swap + deposit + burn LP

use anchor_lang::prelude::*;

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Liquidity Bank",
    project_url: "https://x.com/xchangeagents",
    contacts: "email:xchangeai@proton.me,twitter:https://x.com/xchangeagents",
    policy: "Disclose security issues privately via email or DM. Please give us 30 days to patch before public disclosure.",
    preferred_languages: "en",
    auditors: "None (pending)"
}

mod constants;
mod errors;
mod instructions;
mod pda;
mod state;

use instructions::*;

declare_id!("LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W");

#[program]
pub mod liquiditybank {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        instructions::initialize_protocol::initialize_protocol(ctx)
    }

    pub fn register_launch(ctx: Context<RegisterLaunch>) -> Result<()> {
        instructions::register_launch::register_launch(ctx)
    }

    pub fn collect_curve_fees(ctx: Context<CollectCurveFees>) -> Result<()> {
        instructions::collect_curve_fees::collect_curve_fees(ctx)
    }

    pub fn collect_amm_fees(ctx: Context<CollectAmmFees>) -> Result<()> {
        instructions::collect_amm_fees::collect_amm_fees(ctx)
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
        instructions::grow_lp::grow_lp(
            ctx,
            swap_data,
            swap_account_flags,
            deposit_data,
            deposit_account_flags,
            min_tokens_out_from_swap,
            min_lp_out,
        )
    }

    pub fn burn_from_curve<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFromCurve<'info>>,
        router_data: Vec<u8>,
        router_account_flags: Vec<u8>,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::burn_from_curve::burn_from_curve(
            ctx,
            router_data,
            router_account_flags,
            min_tokens_out,
        )
    }

    /// Pulls protocol launch-fee revenue out to the admin's destination.
    /// Only callable by the admin recorded in protocol_config. Does NOT touch
    /// any launch's fee_owner vault.
    pub fn admin_collect_revenue(
        ctx: Context<AdminCollectRevenue>,
        lamports: u64,
    ) -> Result<()> {
        instructions::admin_collect_revenue::admin_collect_revenue(ctx, lamports)
    }
}
