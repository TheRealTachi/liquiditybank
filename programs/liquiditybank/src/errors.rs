use anchor_lang::prelude::*;

#[error_code]
pub enum LiquidityBankError {
    #[msg("Launch fee not paid in full.")]
    LaunchFeeUnpaid,
    #[msg("Mint must already exist on pump.fun before registering.")]
    MintNotInitialized,
    #[msg("Fee owner PDA is not set as the creator of this mint.")]
    NotCreator,
    #[msg("Crank threshold not yet reached.")]
    BelowCrankThreshold,
    #[msg("Slippage tolerance exceeded.")]
    SlippageExceeded,
    #[msg("Invalid pump.fun or PumpSwap account passed.")]
    InvalidPumpAccount,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Trigger condition not yet met.")]
    TriggerNotMet,
    #[msg("Promise already fulfilled.")]
    AlreadyFulfilled,
    #[msg("Caller is not the dev payout wallet.")]
    NotDev,
    #[msg("Nothing vested yet.")]
    NothingVested,
    #[msg("Token program mismatch.")]
    TokenProgramMismatch,
    #[msg("Caller is not the authorized keeper.")]
    UnauthorizedKeeper,
    #[msg("Router program is not on the allowlist.")]
    DisallowedRouter,
}
