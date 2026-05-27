/**
 * grow_lp manual crank.
 *
 * Reads the PumpSwap pool state for a mint, derives every required PDA,
 * picks valid protocol_fee_recipient + buyback_fee_recipient from the
 * pumpswap global_config, ensures all ATAs exist, and submits the
 * grow_lp instruction.
 *
 * Prerequisites:
 *   - The mint has graduated from the bonding curve to PumpSwap.
 *   - The fee_owner's WSOL ATA holds ≥ 0.5 SOL of WSOL (run collect_curve_fees
 *     or collect_amm_fees first, or wrap native SOL into the WSOL ATA).
 *
 * Usage:
 *   MINT=<mint addr> RPC_URL=... KEYPAIR=... npx tsx scripts/grow-lp.ts
 *
 * What this does in one transaction:
 *   1. (idempotent) create fee_owner's token, lp, wsol ATAs if missing
 *   2. (idempotent) create incinerator's lp ATA if missing
 *   3. call grow_lp with all 30+ accounts wired
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

import idl from "../../target/idl/liquiditybank.json" with { type: "json" };
import {
  LIQUIDITYBANK_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  feeOwnerPda,
  launchConfigPda,
  pumpAmmEventAuthorityPda,
} from "../lib/programs.js";

const INCINERATOR = new PublicKey(
  "1nc1nerator11111111111111111111111111111111"
);

// PumpSwap pool layout offsets (verified
// against IDL account discriminators).
const POOL_DISCRIMINATOR_LEN = 8;
const POOL_BASE_MINT_OFFSET = 43;
const POOL_QUOTE_MINT_OFFSET = 75;
const POOL_BASE_TOKEN_ACCOUNT_OFFSET = 139;
const POOL_QUOTE_TOKEN_ACCOUNT_OFFSET = 171;
const POOL_LP_MINT_OFFSET = 107; // verify: pool struct has lp_mint at 107 in v0 pumpswap
const POOL_COIN_CREATOR_OFFSET = 211;

// PumpSwap global_config fee-recipient arrays.
const GLOBAL_CONFIG_PROTOCOL_FEE_RECIPIENTS_OFFSET = 57;
const GLOBAL_CONFIG_PROTOCOL_FEE_RECIPIENT_COUNT = 8;
const GLOBAL_CONFIG_BUYBACK_FEE_RECIPIENTS_OFFSET = 643;
const GLOBAL_CONFIG_BUYBACK_FEE_RECIPIENT_COUNT = 8;
const PUBKEY_BYTES = 32;

// ----------------------------------------------------------------------------
// PDA derivations specific to grow_lp
// ----------------------------------------------------------------------------
function pumpAmmGlobalConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PUMP_AMM_PROGRAM_ID
  );
}
function pumpAmmGlobalVolumeAccumulator(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_AMM_PROGRAM_ID
  );
}
function pumpAmmUserVolumeAccumulator(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), user.toBuffer()],
    PUMP_AMM_PROGRAM_ID
  );
}
function pumpAmmFeeConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_AMM_PROGRAM_ID.toBuffer()],
    PUMP_FEES_PROGRAM_ID
  );
}
function pumpAmmPoolAuthority(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool-authority"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function pumpAmmCanonicalPool(
  baseMint: PublicKey,
  quoteMint: PublicKey
): [PublicKey, number] {
  const [poolAuthority] = pumpAmmPoolAuthority(baseMint);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      Buffer.from([0, 0]), // u16 LE = 0
      poolAuthority.toBuffer(),
      baseMint.toBuffer(),
      quoteMint.toBuffer(),
    ],
    PUMP_AMM_PROGRAM_ID
  );
}
function pumpAmmPoolV2(baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool-v2"), baseMint.toBuffer()],
    PUMP_AMM_PROGRAM_ID
  );
}
function pumpAmmCreatorVaultAuthority(
  coinCreator: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), coinCreator.toBuffer()],
    PUMP_AMM_PROGRAM_ID
  );
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const MINT_STR = process.env.MINT;
if (!MINT_STR) {
  console.error("Set MINT env var to the mint address");
  process.exit(1);
}
const mint = new PublicKey(MINT_STR);

const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());
const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
const cranker = Keypair.fromSecretKey(Uint8Array.from(secret));

const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(cranker);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const program = new Program(idl as any, provider);

console.log("grow_lp manual crank");
console.log("  mint:    ", mint.toBase58());
console.log("  cranker: ", cranker.publicKey.toBase58());
console.log();

// Find the PumpSwap pool. Prefer canonical pool (newer scheme), fall back to v2.
let pool: PublicKey | null = null;
let poolData: Buffer | null = null;

const [canonical] = pumpAmmCanonicalPool(mint, NATIVE_MINT);
const canonicalInfo = await connection.getAccountInfo(canonical);
if (canonicalInfo && canonicalInfo.data.length > POOL_COIN_CREATOR_OFFSET + 32) {
  pool = canonical;
  poolData = canonicalInfo.data;
  console.log("[*] using canonical pool:", canonical.toBase58());
} else {
  const [v2] = pumpAmmPoolV2(mint);
  const v2Info = await connection.getAccountInfo(v2);
  if (v2Info && v2Info.data.length > POOL_COIN_CREATOR_OFFSET + 32) {
    pool = v2;
    poolData = v2Info.data;
    console.log("[*] using pool-v2:", v2.toBase58());
  }
}

if (!pool || !poolData) {
  console.error(
    "✗ no PumpSwap pool found for this mint. Has the token graduated?"
  );
  process.exit(1);
}

// Extract pool inner accounts.
const poolBaseTokenAccount = new PublicKey(
  poolData.subarray(
    POOL_BASE_TOKEN_ACCOUNT_OFFSET,
    POOL_BASE_TOKEN_ACCOUNT_OFFSET + 32
  )
);
const poolQuoteTokenAccount = new PublicKey(
  poolData.subarray(
    POOL_QUOTE_TOKEN_ACCOUNT_OFFSET,
    POOL_QUOTE_TOKEN_ACCOUNT_OFFSET + 32
  )
);
const coinCreator = new PublicKey(
  poolData.subarray(POOL_COIN_CREATOR_OFFSET, POOL_COIN_CREATOR_OFFSET + 32)
);

console.log("    pool_base_token_account:", poolBaseTokenAccount.toBase58());
console.log("    pool_quote_token_account:", poolQuoteTokenAccount.toBase58());
console.log("    coin_creator (should == fee_owner):", coinCreator.toBase58());

// The pool's LP mint is derived deterministically as the canonical pool's
// authority (or stored in the pool struct). For simplicity we derive the
// expected position and read what's actually at it. PumpSwap layout has
// lp_mint at a different offset depending on pool variant — easiest is to
// look up via the lp_mint account by finding which mint has the pool as
// its authority. For now we trust the v2 layout convention.
const possibleLpMint = new PublicKey(
  poolData.subarray(POOL_LP_MINT_OFFSET, POOL_LP_MINT_OFFSET + 32)
);
console.log("    lp_mint (candidate offset 107):", possibleLpMint.toBase58());
const lpMintInfo = await connection.getAccountInfo(possibleLpMint);
if (!lpMintInfo) {
  console.error(
    "    ✗ lp_mint at offset 107 doesn't exist — pool layout may differ.\n" +
      "      Inspect the pool account data manually to find the correct offset:\n" +
      `      solana account ${pool.toBase58()} --output json --output-file pool.json`
  );
  process.exit(1);
}
const lpMint = possibleLpMint;

// liquiditybank PDAs
const [feeOwner] = feeOwnerPda(mint);
const [launchConfig] = launchConfigPda(mint);

if (coinCreator.toBase58() !== feeOwner.toBase58()) {
  console.error(
    `    ✗ pool.coin_creator (${coinCreator.toBase58()}) != fee_owner (${feeOwner.toBase58()})\n` +
      "    This launch was not created through liquiditybank."
  );
  process.exit(1);
}

// PumpSwap global config + pick recipient pubkeys
const [globalConfig] = pumpAmmGlobalConfig();
const globalConfigInfo = await connection.getAccountInfo(globalConfig);
if (!globalConfigInfo) {
  console.error("    ✗ pumpswap global_config not found");
  process.exit(1);
}
const protocolFeeRecipient = new PublicKey(
  globalConfigInfo.data.subarray(
    GLOBAL_CONFIG_PROTOCOL_FEE_RECIPIENTS_OFFSET,
    GLOBAL_CONFIG_PROTOCOL_FEE_RECIPIENTS_OFFSET + 32
  )
);
const buybackFeeRecipient = new PublicKey(
  globalConfigInfo.data.subarray(
    GLOBAL_CONFIG_BUYBACK_FEE_RECIPIENTS_OFFSET,
    GLOBAL_CONFIG_BUYBACK_FEE_RECIPIENTS_OFFSET + 32
  )
);
console.log("    protocol_fee_recipient:", protocolFeeRecipient.toBase58());
console.log("    buyback_fee_recipient: ", buybackFeeRecipient.toBase58());

// Remaining PDAs
const [poolV2] = pumpAmmPoolV2(mint);
const [globalVolumeAccumulator] = pumpAmmGlobalVolumeAccumulator();
const [userVolumeAccumulator] = pumpAmmUserVolumeAccumulator(feeOwner);
const [feeConfig] = pumpAmmFeeConfig();
const [coinCreatorVaultAuthority] = pumpAmmCreatorVaultAuthority(feeOwner);
const [pumpAmmEventAuthority] = pumpAmmEventAuthorityPda();

// ATAs
const feeOwnerWsolAta = await getAssociatedTokenAddress(
  NATIVE_MINT,
  feeOwner,
  true
);
const feeOwnerTokenAta = await getAssociatedTokenAddress(mint, feeOwner, true);
const feeOwnerLpAta = await getAssociatedTokenAddress(lpMint, feeOwner, true);
const incineratorLpAta = await getAssociatedTokenAddress(
  lpMint,
  INCINERATOR,
  true
);
const protocolFeeRecipientTokenAccount = await getAssociatedTokenAddress(
  NATIVE_MINT,
  protocolFeeRecipient,
  true
);
const buybackFeeRecipientTokenAccount = await getAssociatedTokenAddress(
  NATIVE_MINT,
  buybackFeeRecipient,
  true
);
const coinCreatorVaultAta = await getAssociatedTokenAddress(
  NATIVE_MINT,
  coinCreatorVaultAuthority,
  true
);

// Check fee_owner WSOL balance before
const wsolInfo = await connection.getAccountInfo(feeOwnerWsolAta);
if (!wsolInfo) {
  console.error("    ✗ fee_owner WSOL ATA doesn't exist. Run collect_*_fees first.");
  process.exit(1);
}
const wsolBalance = await connection.getTokenAccountBalance(feeOwnerWsolAta);
console.log(`    fee_owner WSOL balance: ${wsolBalance.value.uiAmountString} SOL`);
if (BigInt(wsolBalance.value.amount) < 500_000_000n) {
  console.error(
    "    ✗ fee_owner has less than 0.5 SOL WSOL. grow_lp requires ≥ 0.5 SOL accumulated."
  );
  process.exit(1);
}

// Build the tx
console.log("\n[*] assembling grow_lp tx with " + 27 + " accounts…");
const tx = new Transaction();

// Add idempotent ATA creates for fee_owner's token + lp ATAs (and incinerator's lp ATA).
tx.add(
  createAssociatedTokenAccountIdempotentInstruction(
    cranker.publicKey,
    feeOwnerTokenAta,
    feeOwner,
    mint
  ),
  createAssociatedTokenAccountIdempotentInstruction(
    cranker.publicKey,
    feeOwnerLpAta,
    feeOwner,
    lpMint
  ),
  createAssociatedTokenAccountIdempotentInstruction(
    cranker.publicKey,
    incineratorLpAta,
    INCINERATOR,
    lpMint
  )
);

// Bump CU budget for the heavy CPI.
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));

const growLpIx = await program.methods
  .growLp(new BN(0), new BN(0)) // min_tokens_out = 0, min_lp_out = 0 (test-only — set real slippage in prod)
  .accounts({
    cranker: cranker.publicKey,
    mint,
    launchConfig,
    feeOwner,
    feeOwnerWsolAta,
    feeOwnerTokenAta,
    feeOwnerLpAta,
    incineratorLpAta,
    pool,
    poolV2,
    poolBaseTokenAccount,
    poolQuoteTokenAccount,
    lpMint,
    globalConfig,
    globalVolumeAccumulator,
    userVolumeAccumulator,
    feeConfig,
    feeProgram: PUMP_FEES_PROGRAM_ID,
    protocolFeeRecipient,
    protocolFeeRecipientTokenAccount,
    buybackFeeRecipient,
    buybackFeeRecipientTokenAccount,
    coinCreatorVaultAuthority,
    coinCreatorVaultAta,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    pumpAmmEventAuthority,
    pumpAmmProgram: PUMP_AMM_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
tx.add(growLpIx);

console.log("[*] submitting…");
try {
  const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  console.log("✓ grow_lp confirmed:", sig);

  // Re-read state
  const lc = await (program.account as any).launchConfig.fetch(launchConfig);
  console.log("\n[*] launch state after crank:");
  console.log("  cumulativeLpSolAdded:", lc.cumulativeLpSolAdded.toString());
  console.log("  cumulativeLpBurned:  ", lc.cumulativeLpBurned.toString());
  console.log("  crankCount:          ", lc.crankCount.toString());
} catch (e: any) {
  console.error("\n✗ grow_lp FAILED");
  console.error("  ", e?.message ?? e);
  if (e?.logs) {
    console.error("  logs:");
    for (const l of e.logs) console.error("   ", l);
  }
  process.exit(1);
}
