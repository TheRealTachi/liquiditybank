import { PublicKey } from "@solana/web3.js";

// ----------------------------------------------------------------------------
// External programs (verified from IDLs fetched 2026-05)
// ----------------------------------------------------------------------------
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
export const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);
export const PUMP_FEES_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
export const INCINERATOR = new PublicKey(
  "1nc1nerator11111111111111111111111111111111"
);

// ----------------------------------------------------------------------------
// Liquidity Bank program (synced via `anchor keys sync`)
// ----------------------------------------------------------------------------
export const LIQUIDITYBANK_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W"
);

// ----------------------------------------------------------------------------
// Instruction discriminators (verified from on-chain IDLs)
// ----------------------------------------------------------------------------
export const PUMP_CREATE_IX_DISCRIMINATOR = Buffer.from([
  24, 30, 200, 40, 5, 28, 7, 119,
]);
