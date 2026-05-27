use anchor_lang::prelude::*;

// ----------------------------------------------------------------------------
// LaunchConfig
// ----------------------------------------------------------------------------
//
// Immutable record per launch. Set once at register_launch; never mutated
// (only counter fields update). All program behaviour for this mint flows
// from this struct.

#[account]
#[derive(InitSpace)]
pub struct LaunchConfig {
    /// The pump.fun token mint this launch wraps.
    pub mint: Pubkey,

    /// The wallet that paid the LAUNCH_FEE_LAMPORTS on registration. Recorded
    /// for telemetry only — has no on-chain authority.
    pub registrant: Pubkey,

    /// Bump for the LaunchConfig PDA.
    pub bump: u8,

    /// Bump for the per-launch fee_owner PDA (the pump.fun creator).
    pub fee_owner_bump: u8,

    /// Cumulative SOL pulled into fee_owner across this launch's life
    /// (curve fees + amm fees, summed across all crank cycles).
    pub cumulative_fees_collected: u64,

    /// Cumulative SOL spent on the LP-add cycle (buy half + pair).
    pub cumulative_lp_sol_added: u64,

    /// Cumulative LP tokens minted and burned via the crank.
    pub cumulative_lp_burned: u64,

    /// Cumulative SOL spent on pre-bond buy-and-burn cycles.
    pub cumulative_curve_sol_spent: u64,

    /// Cumulative tokens burned via pre-bond buy-and-burn.
    pub cumulative_tokens_burned: u64,

    /// Number of times the grow_lp crank has fired.
    pub crank_count: u64,

    /// Number of times the burn_from_curve crank has fired.
    pub curve_burn_count: u64,

    /// Unix timestamp of registration.
    pub created_at: i64,
}

// ----------------------------------------------------------------------------
// ProtocolConfig
// ----------------------------------------------------------------------------
//
// Singleton account, created once at deploy time. Holds the protocol admin
// (used only for collecting protocol revenue) and a `paused` flag for the
// beta period.

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub bump: u8,
    pub paused: bool,
    pub total_launches: u64,
    pub total_revenue_lamports: u64,
}
