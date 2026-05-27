use anchor_lang::prelude::*;

use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"protocol-config"],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: PDA used as a lamport sink for the launch fee. No data, no auth.
    #[account(
        mut,
        seeds = [b"protocol-revenue"],
        bump,
    )]
    pub protocol_revenue: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
    let cfg = &mut ctx.accounts.protocol_config;
    cfg.admin = ctx.accounts.admin.key();
    cfg.bump = ctx.bumps.protocol_config;
    cfg.paused = false;
    cfg.total_launches = 0;
    cfg.total_revenue_lamports = 0;

    // Touch the protocol_revenue PDA so it can hold lamports. We don't init it
    // as a typed account — it's a bare lamport sink. System program will
    // implicitly create it on first SOL transfer.

    Ok(())
}
