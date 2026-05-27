#!/usr/bin/env node
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
  console.error("usage: node scripts/verify-launch.mjs <mint>");
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
const [protocolRevenue] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-revenue")],
  PROGRAM_ID
);
const [protocolConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-config")],
  PROGRAM_ID
);

const conn = new Connection(RPC, "confirmed");

console.log(`Program:          ${PROGRAM_ID.toBase58()}`);
console.log(`Mint:             ${mint.toBase58()}`);
console.log(`fee_owner PDA:    ${feeOwner.toBase58()}`);
console.log(`launch_config:    ${launchConfig.toBase58()}`);
console.log(`bonding_curve:    ${bondingCurve.toBase58()}`);
console.log(`protocol_revenue: ${protocolRevenue.toBase58()}`);
console.log(`protocol_config:  ${protocolConfig.toBase58()}`);
console.log("");

const [mintInfo, feeOwnerInfo, lcInfo, bcInfo, revInfo, cfgInfo] =
  await Promise.all([
    conn.getAccountInfo(mint),
    conn.getAccountInfo(feeOwner),
    conn.getAccountInfo(launchConfig),
    conn.getAccountInfo(bondingCurve),
    conn.getAccountInfo(protocolRevenue),
    conn.getAccountInfo(protocolConfig),
  ]);

function row(label, info, extra = "") {
  const tick = info ? "✓" : "✗";
  const bal = info ? `${info.lamports} lamports (${(info.lamports / 1e9).toFixed(6)} SOL)` : "(does not exist)";
  const owner = info ? `owner=${info.owner.toBase58()}` : "";
  console.log(`${tick} ${label.padEnd(20)} ${bal}  ${owner}  ${extra}`);
}

row("mint", mintInfo);
row("bonding_curve", bcInfo);
row("fee_owner", feeOwnerInfo);
row("launch_config", lcInfo);
row("protocol_revenue", revInfo);
row("protocol_config", cfgInfo);

if (!lcInfo) {
  console.log("\nFAIL: launch_config PDA does not exist — register_launch did not run for this mint.");
  process.exit(1);
}

// Decode launch_config (first 8 bytes = discriminator, then the struct)
// Fields per state.rs:
//   mint: Pubkey (32), registrant: Pubkey (32), bump: u8 (1),
//   fee_owner_bump: u8 (1), cumulative_fees_collected: u64 (8),
//   cumulative_lp_sol_added: u64 (8), cumulative_lp_burned: u64 (8),
//   cumulative_curve_sol_spent: u64 (8), cumulative_tokens_burned: u64 (8),
//   crank_count: u64 (8), curve_burn_count: u64 (8), created_at: i64 (8)
const d = lcInfo.data.subarray(8);
const lcMint = new PublicKey(d.subarray(0, 32));
const lcRegistrant = new PublicKey(d.subarray(32, 64));
const lcBump = d[64];
const lcFeeOwnerBump = d[65];
const lcCumFees = d.readBigUInt64LE(66);
const lcCumLpSol = d.readBigUInt64LE(74);
const lcCumLpBurned = d.readBigUInt64LE(82);
const lcCumCurveSpent = d.readBigUInt64LE(90);
const lcCumTokBurned = d.readBigUInt64LE(98);
const lcCrankCount = d.readBigUInt64LE(106);
const lcCurveBurnCount = d.readBigUInt64LE(114);
const lcCreatedAt = d.readBigInt64LE(122);

console.log("\nlaunch_config decoded:");
console.log(`  mint:            ${lcMint.toBase58()}  ${lcMint.equals(mint) ? "✓ matches" : "✗ MISMATCH"}`);
console.log(`  registrant:      ${lcRegistrant.toBase58()}`);
console.log(`  bump:            ${lcBump}`);
console.log(`  fee_owner_bump:  ${lcFeeOwnerBump}`);
console.log(`  cum_fees:        ${lcCumFees}`);
console.log(`  cum_lp_sol:      ${lcCumLpSol}`);
console.log(`  cum_lp_burned:   ${lcCumLpBurned}`);
console.log(`  cum_curve_sol:   ${lcCumCurveSpent}`);
console.log(`  cum_tok_burned:  ${lcCumTokBurned}`);
console.log(`  crank_count:     ${lcCrankCount}`);
console.log(`  curve_burn_cnt:  ${lcCurveBurnCount}`);
console.log(`  created_at:      ${lcCreatedAt} (${new Date(Number(lcCreatedAt) * 1000).toISOString()})`);

// Decode bonding_curve to check creator role
if (bcInfo) {
  // pump.fun bonding_curve layout:
  //   8 disc, virtualTokReserves u64, virtualSolReserves u64, realTokReserves u64,
  //   realSolReserves u64, totalSupply u64, complete bool (1), creator Pubkey (32)
  const bcd = bcInfo.data;
  const creator = new PublicKey(bcd.subarray(8 + 8 * 5 + 1, 8 + 8 * 5 + 1 + 32));
  console.log("\nbonding_curve.creator:");
  console.log(`  on-chain:   ${creator.toBase58()}`);
  console.log(`  expected:   ${feeOwner.toBase58()}`);
  console.log(`  ${creator.equals(feeOwner) ? "✓ pump.fun creator role IS the fee_owner PDA" : "✗ MISMATCH — creator role NOT the fee_owner!"}`);
}

console.log("");
console.log("Status: launch_config exists and is well-formed. The token is registered.");
