#!/usr/bin/env node
/**
 * Read-only diagnostic: where are the creator fees for a launched mint?
 *
 * Checks:
 *   - bonding_curve state (volume, complete?)
 *   - pump.fun creator_vault PDA for our fee_owner (pending fees pool)
 *   - fee_owner PDA balance (collected fees, post-crank)
 *   - launch_config cumulative counters
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const idl = JSON.parse(
  readFileSync(path.join(process.cwd(), "lib/liquiditybank.idl.json"), "utf8")
);
const PROGRAM_ID = new PublicKey(idl.address);
const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const mintArg = process.argv[2];
if (!mintArg) {
  console.error("usage: node scripts/check-fees.mjs <mint>");
  process.exit(1);
}
const mint = new PublicKey(mintArg);

const [feeOwner] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee-owner"), mint.toBuffer()],
  PROGRAM_ID
);
const [launchConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("launch-config"), mint.toBuffer()],
  PROGRAM_ID
);
const [bondingCurve] = PublicKey.findProgramAddressSync(
  [Buffer.from("bonding-curve"), mint.toBuffer()],
  PUMP_PROGRAM_ID
);
const [creatorVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("creator-vault"), feeOwner.toBuffer()],
  PUMP_PROGRAM_ID
);

const conn = new Connection(RPC, "confirmed");

const [bcInfo, feeOwnerInfo, lcInfo, cvInfo] = await Promise.all([
  conn.getAccountInfo(bondingCurve),
  conn.getAccountInfo(feeOwner),
  conn.getAccountInfo(launchConfig),
  conn.getAccountInfo(creatorVault),
]);

console.log(`Mint:             ${mint.toBase58()}`);
console.log(`fee_owner:        ${feeOwner.toBase58()}`);
console.log(`launch_config:    ${launchConfig.toBase58()}`);
console.log(`bonding_curve:    ${bondingCurve.toBase58()}`);
console.log(`creator_vault:    ${creatorVault.toBase58()}`);
console.log("");

if (!bcInfo) {
  console.log("✗ bonding_curve does not exist");
  process.exit(1);
}

// pump.fun bonding_curve layout (from pump.fun IDL):
//   8 disc
//   virtual_token_reserves u64
//   virtual_sol_reserves u64
//   real_token_reserves u64
//   real_sol_reserves u64
//   token_total_supply u64
//   complete u8 (bool)
//   creator Pubkey (32)
const bcd = bcInfo.data;
const virtualTokR = bcd.readBigUInt64LE(8);
const virtualSolR = bcd.readBigUInt64LE(16);
const realTokR = bcd.readBigUInt64LE(24);
const realSolR = bcd.readBigUInt64LE(32);
const totalSupply = bcd.readBigUInt64LE(40);
const complete = bcd[48];
const creator = new PublicKey(bcd.subarray(49, 49 + 32));

const SOL = (n) => `${n} (${(Number(n) / 1e9).toFixed(6)} SOL)`;

console.log("BONDING CURVE STATE");
console.log(`  complete (graduated to PumpSwap?):  ${complete ? "YES" : "no"}`);
console.log(`  real_sol_reserves:   ${SOL(realSolR)}`);
console.log(`  virtual_sol_reserves: ${SOL(virtualSolR)}`);
console.log(`  real_token_reserves:  ${realTokR}`);
console.log(`  total_supply:         ${totalSupply}`);
console.log(`  creator (on curve):   ${creator.toBase58()}  ${creator.equals(feeOwner) ? "✓" : "✗ MISMATCH"}`);
console.log("");

console.log("CREATOR_VAULT (pump.fun's pending-fees pool for this creator)");
if (!cvInfo) {
  console.log(
    "  (does not exist yet — pump.fun creates this lazily on first creator-fee accrual)\n  ⇒ no trading-fee creator-cut has accrued yet."
  );
} else {
  console.log(`  balance:  ${SOL(BigInt(cvInfo.lamports))}`);
  console.log(`  owner:    ${cvInfo.owner.toBase58()}`);
  console.log("  ⇒ this SOL is claimable by collect_curve_fees.");
}
console.log("");

console.log("FEE_OWNER (our PDA — accumulates fees AFTER cranking)");
if (!feeOwnerInfo) {
  console.log("  (does not exist yet — created on first transfer in)");
  console.log("  ⇒ no collect_curve_fees has ever run for this mint.");
} else {
  console.log(`  balance:  ${SOL(BigInt(feeOwnerInfo.lamports))}`);
  console.log(`  owner:    ${feeOwnerInfo.owner.toBase58()}`);
}
console.log("");

if (lcInfo) {
  const d = lcInfo.data.subarray(8);
  const cum_fees = d.readBigUInt64LE(66);
  const crank_count = d.readBigUInt64LE(106);
  console.log("LAUNCH_CONFIG counters");
  console.log(`  cumulative_fees_collected:  ${SOL(cum_fees)}`);
  console.log(`  crank_count (grow_lp runs): ${crank_count}`);
}
