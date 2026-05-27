//! PDA derivations. Most of these are used by the off-chain client (TypeScript
//! SDK / launchpad frontend) to construct instructions; only a subset show up
//! in on-chain code paths. The `#[allow(dead_code)]` suppresses warnings from
//! the on-chain-only build.

#![allow(dead_code)]

use anchor_lang::prelude::*;

use crate::constants::*;

// ----------------------------------------------------------------------------
// Liquidity Bank-owned PDAs
// ----------------------------------------------------------------------------

/// Per-launch authority. This is the pump.fun creator role for the mint and
/// the WSOL/SOL custody for fee accumulation. Has no withdrawal instruction.
pub fn fee_owner_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"fee-owner", mint.as_ref()], &crate::ID)
}

/// Per-launch config holding immutable parameters (fee split, vest schedule,
/// crank threshold, dev payout wallet, etc.) set at register_launch time.
pub fn launch_config_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"launch-config", mint.as_ref()], &crate::ID)
}

/// Protocol-wide revenue sink. Receives LAUNCH_FEE_LAMPORTS on each
/// register_launch. Owned by the protocol admin (set at program init).
pub fn protocol_revenue_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"protocol-revenue"], &crate::ID)
}

/// Protocol-wide config (admin, paused flag for emergencies in beta only;
/// to be renounced before mainnet hardening).
pub fn protocol_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"protocol-config"], &crate::ID)
}

// ----------------------------------------------------------------------------
// External PDAs (pump.fun / PumpSwap derivations, mirrored from staked repo)
// ----------------------------------------------------------------------------

pub fn pump_bonding_curve_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &PUMP_PROGRAM_ID)
}

pub fn pump_creator_vault_pda(creator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"creator-vault", creator.as_ref()], &PUMP_PROGRAM_ID)
}

pub fn pump_event_authority_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &PUMP_PROGRAM_ID)
}

pub fn pump_amm_creator_vault_authority_pda(creator: &Pubkey) -> (Pubkey, u8) {
    // Note: pump_amm uses underscore seed, not dash.
    Pubkey::find_program_address(&[b"creator_vault", creator.as_ref()], &PUMP_AMM_PROGRAM_ID)
}

pub fn pump_amm_event_authority_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &PUMP_AMM_PROGRAM_ID)
}

pub fn pump_amm_global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"global_config"], &PUMP_AMM_PROGRAM_ID)
}

pub fn pump_amm_global_volume_accumulator_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"global_volume_accumulator"], &PUMP_AMM_PROGRAM_ID)
}

pub fn pump_amm_fee_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"fee_config", PUMP_AMM_PROGRAM_ID.as_ref()],
        &PUMP_FEES_PROGRAM_ID,
    )
}

pub fn pump_amm_pool_authority_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pool-authority", mint.as_ref()], &PUMP_PROGRAM_ID)
}

pub fn pump_amm_canonical_pool_pda(base_mint: &Pubkey, quote_mint: &Pubkey) -> (Pubkey, u8) {
    let pool_authority = pump_amm_pool_authority_pda(base_mint).0;
    Pubkey::find_program_address(
        &[
            b"pool",
            &0_u16.to_le_bytes(),
            pool_authority.as_ref(),
            base_mint.as_ref(),
            quote_mint.as_ref(),
        ],
        &PUMP_AMM_PROGRAM_ID,
    )
}

pub fn pump_amm_pool_v2_pda(base_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pool-v2", base_mint.as_ref()], &PUMP_AMM_PROGRAM_ID)
}

pub fn associated_token_address(
    authority: &Pubkey,
    token_program: &Pubkey,
    mint: &Pubkey,
) -> Pubkey {
    Pubkey::find_program_address(
        &[authority.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}
