#![allow(dead_code)]

use anchor_lang::prelude::*;

// ============================================================================
// External program IDs (verified against iceypump/staked main as of 2026-05)
// ============================================================================
pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const PUMP_AMM_PROGRAM_ID: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const PUMP_FEES_PROGRAM_ID: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

/// Programs that the fund-spending router CPIs (`burn_from_curve`, `grow_lp`)
/// are permitted to invoke. The router instructions hand the `fee_owner` PDA's
/// signature to whatever program is passed; without this allowlist an attacker
/// could pass their own program and drain the vault. Restricting to pump.fun's
/// bonding curve and the PumpSwap AMM — both immutable, trusted programs that
/// only ever return assets to `fee_owner` — bounds the blast radius even if the
/// keeper key is ever compromised. Add a program here (and upgrade) to support
/// a new venue.
pub const ALLOWED_ROUTER_PROGRAMS: [Pubkey; 2] =
    [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID];

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const NATIVE_MINT_ID: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

// Canonical incinerator address — sending SPL tokens here burns them permanently.
pub const INCINERATOR: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");

// ============================================================================
// Pump.fun instruction discriminators (verified from staked repo constants.rs)
// ============================================================================
pub const PUMP_COLLECT_CREATOR_FEE_IX: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];
pub const PUMP_COLLECT_CREATOR_FEE_V2_IX: [u8; 8] = [207, 17, 138, 242, 4, 34, 19, 56];
pub const PUMP_AMM_COLLECT_COIN_CREATOR_FEE_IX: [u8; 8] =
    [160, 57, 89, 42, 181, 139, 43, 66];
pub const PUMP_AMM_BUY_EXACT_QUOTE_IN_IX: [u8; 8] = [198, 46, 21, 82, 180, 217, 232, 112];

// Pump.fun bonding-curve `buy_exact_sol_in` (LEGACY, 16 accounts).
// Kept for reference; not used after v2 upgrade.
pub const PUMP_BUY_EXACT_SOL_IN_IX: [u8; 8] = [56, 252, 116, 8, 158, 223, 205, 95];

// Pump.fun bonding-curve `buy_exact_quote_in_v2` (current, 27 accounts).
// Verified against live pump.fun IDL.
// Args: spendable_quote_in (u64), min_tokens_out (u64). Quote is WSOL.
pub const PUMP_BUY_EXACT_QUOTE_IN_V2_IX: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];

// PumpSwap `deposit` (add_liquidity) discriminator.
// Verified against the live PumpSwap IDL fetched from mainnet.
pub const PUMP_AMM_DEPOSIT_IX: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

// Pump.fun `create` (new token launch).
// Verified against the live pump.fun IDL.
// Args: name (string), symbol (string), uri (string), creator (pubkey)
pub const PUMP_CREATE_IX: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];

// SPL Token raw instruction tags (used when we build instructions manually).
pub const SPL_TOKEN_TRANSFER_IX: u8 = 3;
pub const SPL_TOKEN_BURN_IX: u8 = 8;
pub const SPL_TOKEN_CLOSE_ACCOUNT_IX: u8 = 9;
pub const SPL_TOKEN_SYNC_NATIVE_IX: u8 = 17;

// ============================================================================
// Liquidity Bank protocol parameters
// ============================================================================
pub const BPS_DENOMINATOR: u64 = 10_000;

/// The sole wallet authorized to fire the fund-spending cranks
/// (`burn_from_curve`, `grow_lp`). These instructions sign as the per-launch
/// `fee_owner` PDA and forward caller-supplied instruction data to a router, so
/// the caller fully controls slippage/min-out; leaving them permissionless lets
/// anyone route a vault's SOL through a pool they control and extract it. Gating
/// to the protocol keeper closes that path. Fee-*collection* cranks
/// (`collect_curve_fees`, `collect_amm_fees`) stay permissionless — they only
/// move fees INTO `fee_owner` via hardcoded pump CPIs. Rotate via program upgrade.
pub const KEEPER_AUTHORITY: Pubkey =
    pubkey!("LiqwZ2BKDF74nukVJATE17Bk9TJMzAcuKEEMQ4fp3r4");

/// Minimum SOL accumulated in the fee_owner PDA before the crank may fire.
/// Prevents wasting tx fees on dust adds. 0.5 SOL.
pub const CRANK_THRESHOLD_LAMPORTS: u64 = 500_000_000;

/// Crank reward paid to whoever lands the `grow_lp` tx. ~0.001 SOL.
pub const CRANK_REWARD_LAMPORTS: u64 = 1_000_000;

/// Minimum SOL kept in fee_owner after a burn_from_curve cycle (rent-exempt
/// reserve + safety margin). 0.01 SOL.
pub const FEE_OWNER_RESERVE_LAMPORTS: u64 = 10_000_000;

/// One-time service fee paid into the protocol revenue PDA on `register_launch`.
/// 0.02 SOL. Sized so the user's total deposit (rent + tx + this fee + buffer)
/// fits inside 0.05 SOL.
pub const LAUNCH_FEE_LAMPORTS: u64 = 20_000_000;
