/**
 * burn_from_curve — pre-graduation crank.
 *
 * The on-chain burn_from_curve takes a router CPI: caller supplies a swap
 * instruction (router program id + ix data + account list + per-account
 * is_writable/is_signer flag bytes) and the program forwards it with
 * fee_owner as the PDA signer. The program then SPL-burns whatever tokens
 * landed in fee_owner's token ATA — a real supply reduction.
 *
 * We use pump.fun's `buy` instruction directly as the router. Jupiter v6
 * cannot route pre-graduation pump.fun tokens (NO_ROUTES_FOUND); the AMM
 * aggregators only pick up the mint after it migrates to PumpSwap. Post-
 * graduation, switch to grow_lp (which does swap + LP deposit + burn-LP).
 *
 * Prerequisites:
 *   - Token has NOT graduated (bonding_curve.complete == 0)
 *   - fee_owner has ≥ CRANK_THRESHOLD_LAMPORTS (0.5 SOL) of bare SOL
 *     (run collect_curve_fees first to claim accumulated creator fees)
 *
 * Usage:
 *   MINT=<mint> RPC_URL=... KEYPAIR=... [PROGRAM_ID=...] \
 *     npx tsx scripts/burn-from-curve.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
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
  PUMP_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  feeOwnerPda,
  launchConfigPda,
  pumpEventAuthorityPda,
  pumpCreatorVaultPda,
} from "../lib/programs.js";

// Anchor sighash("global:buy") — pump.fun bonding-curve buy ix
const PUMP_BUY_IX_DISCRIM = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

// Offset of fee_recipient inside pump.fun's global PDA:
// 8 (discriminator) + 1 (initialized) + 32 (authority) = 41
const PUMP_GLOBAL_FEE_RECIPIENT_OFFSET = 41;

// On-chain check in burn_from_curve.rs requires fee_owner ≥ this. Mirrored
// here so we fail fast with a clear message instead of paying for a tx that
// the program will reject.
const CRANK_THRESHOLD_LAMPORTS = 500_000_000;

// FEE_OWNER_RESERVE (0.01) + CRANK_REWARD (0.001) — held back in fee_owner
// after each crank. The on-chain program subtracts these to compute spend.
const RESERVE_LAMPORTS = 11_000_000;

// ----------------------------------------------------------------------------
// PDAs
// ----------------------------------------------------------------------------
function pumpGlobalPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM_ID);
}
function pumpBondingCurvePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function pumpGlobalVolumeAccumulatorPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM_ID
  );
}
function pumpUserVolumeAccumulatorPda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), user.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function pumpFeeConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM_ID.toBuffer()],
    PUMP_FEES_PROGRAM_ID
  );
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const MINT_STR = process.env.MINT;
if (!MINT_STR) {
  console.error("Set MINT env var");
  process.exit(1);
}
const mint = new PublicKey(MINT_STR);

const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());
const cranker = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
);

const connection = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(cranker), {
  commitment: "confirmed",
});
const program = new Program(idl as any, provider);

console.log("burn_from_curve (pre-grad, router CPI = pump.fun buy)");
console.log("  mint:   ", mint.toBase58());
console.log("  cranker:", cranker.publicKey.toBase58());

const [feeOwner] = feeOwnerPda(mint);
const [launchConfig] = launchConfigPda(mint);
console.log("  fee_owner:", feeOwner.toBase58());

// ---- Pre-flight ----
const feeOwnerSol = await connection.getBalance(feeOwner);
console.log("  fee_owner SOL:", (feeOwnerSol / LAMPORTS_PER_SOL).toFixed(4), "SOL");
if (feeOwnerSol < CRANK_THRESHOLD_LAMPORTS) {
  console.error(
    `✗ fee_owner has ${(feeOwnerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
    `below CRANK_THRESHOLD_LAMPORTS = ${CRANK_THRESHOLD_LAMPORTS / LAMPORTS_PER_SOL} SOL. ` +
    `Run collect_curve_fees first or wait for more trades.`
  );
  process.exit(1);
}

const [bondingCurve] = pumpBondingCurvePda(mint);
const bcInfo = await connection.getAccountInfo(bondingCurve);
if (!bcInfo) {
  console.error("✗ no pump.fun bonding_curve for this mint");
  process.exit(1);
}
if (bcInfo.data.readUInt8(48) === 1) {
  console.error("✗ bonding curve has graduated — use grow_lp instead");
  process.exit(1);
}
const vTokR = bcInfo.data.readBigUInt64LE(8);
const vSolR = bcInfo.data.readBigUInt64LE(16);

const swapAmount = feeOwnerSol - RESERVE_LAMPORTS;
console.log("  swap amount:", (swapAmount / LAMPORTS_PER_SOL).toFixed(4), "SOL");

// Constant-product math on the bonding curve, with pump.fun's 1% fee on input.
// Shave 5% from gross tokens-out as a margin against the on-chain fee
// schedule changing under us (max_sol_cost still caps loss either way).
const solAfterFee = (BigInt(swapAmount) * 99n) / 100n;
const newVSolR = vSolR + solAfterFee;
const newVTokR = (vTokR * vSolR) / newVSolR;
const grossOut = vTokR - newVTokR;
const buyAmount = (grossOut * 95n) / 100n;
console.log("  buy amount:", buyAmount.toString(), "(gross", grossOut.toString(), ")");

// ---- pump.fun globals ----
const [pumpGlobal] = pumpGlobalPda();
const globalAccount = await connection.getAccountInfo(pumpGlobal);
if (!globalAccount) {
  console.error("✗ pump.fun global PDA not found");
  process.exit(1);
}
const pumpFeeRecipient = new PublicKey(
  globalAccount.data.subarray(
    PUMP_GLOBAL_FEE_RECIPIENT_OFFSET,
    PUMP_GLOBAL_FEE_RECIPIENT_OFFSET + 32
  )
);

const pumpAssociatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurve, true);
const [pumpCreatorVault] = pumpCreatorVaultPda(feeOwner);
const [pumpEventAuthority] = pumpEventAuthorityPda();
const [pumpGlobalVolumeAccumulator] = pumpGlobalVolumeAccumulatorPda();
const [pumpUserVolumeAccumulator] = pumpUserVolumeAccumulatorPda(feeOwner);
const [pumpFeeConfig] = pumpFeeConfigPda();

const feeOwnerTokenAta = await getAssociatedTokenAddress(mint, feeOwner, true);
const feeOwnerWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, feeOwner, true);

// ---- pump.fun buy ix accounts (16, in pump.fun's documented order) ----
const pumpBuyAccounts = [
  { pubkey: pumpGlobal,                  isWritable: false, isSigner: false },
  { pubkey: pumpFeeRecipient,            isWritable: true,  isSigner: false },
  { pubkey: mint,                        isWritable: false, isSigner: false },
  { pubkey: bondingCurve,                isWritable: true,  isSigner: false },
  { pubkey: pumpAssociatedBondingCurve,  isWritable: true,  isSigner: false },
  { pubkey: feeOwnerTokenAta,            isWritable: true,  isSigner: false },
  { pubkey: feeOwner,                    isWritable: true,  isSigner: true  },
  { pubkey: SystemProgram.programId,     isWritable: false, isSigner: false },
  { pubkey: TOKEN_PROGRAM_ID,            isWritable: false, isSigner: false },
  { pubkey: pumpCreatorVault,            isWritable: true,  isSigner: false },
  { pubkey: pumpEventAuthority,          isWritable: false, isSigner: false },
  { pubkey: PUMP_PROGRAM_ID,             isWritable: false, isSigner: false },
  { pubkey: pumpGlobalVolumeAccumulator, isWritable: true,  isSigner: false },
  { pubkey: pumpUserVolumeAccumulator,   isWritable: true,  isSigner: false },
  { pubkey: pumpFeeConfig,               isWritable: false, isSigner: false },
  { pubkey: PUMP_FEES_PROGRAM_ID,        isWritable: false, isSigner: false },
];

// buy(amount: u64, max_sol_cost: u64)
const routerData = Buffer.alloc(8 + 8 + 8);
PUMP_BUY_IX_DISCRIM.copy(routerData, 0);
routerData.writeBigUInt64LE(buyAmount, 8);
routerData.writeBigUInt64LE(BigInt(swapAmount), 16);

// Flag byte per account: bit0 = is_writable, bit1 = is_signer.
// Pass to remaining_accounts NOT-as-signer; the on-chain program re-derives
// is_signer locally and only signs for fee_owner via invoke_signed.
const flags = Buffer.alloc(pumpBuyAccounts.length);
const remainingAccounts = pumpBuyAccounts.map((a, i) => {
  let f = 0;
  if (a.isWritable) f |= 0b01;
  if (a.isSigner)   f |= 0b10;
  flags[i] = f;
  return { pubkey: a.pubkey, isSigner: false, isWritable: a.isWritable };
});

// ---- Build + send ----
console.log("\n[*] assembling burn_from_curve tx…");

const tx = new Transaction();
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

// fee_owner needs its mint ATA + WSOL ATA before burn_from_curve runs.
// Cranker pays the rent (~0.002 SOL each); idempotent so safe to re-run.
tx.add(
  createAssociatedTokenAccountIdempotentInstruction(
    cranker.publicKey, feeOwnerTokenAta, feeOwner, mint
  ),
  createAssociatedTokenAccountIdempotentInstruction(
    cranker.publicKey, feeOwnerWsolAta, feeOwner, NATIVE_MINT
  )
);

const burnIx = await program.methods
  .burnFromCurve(routerData, flags, new BN(0)) // min_tokens_out = 0 (test); set real slippage in prod
  .accounts({
    cranker: cranker.publicKey,
    mint,
    launchConfig,
    feeOwner,
    feeOwnerTokenAta,
    feeOwnerWsolAta,
    quoteMint: NATIVE_MINT,
    routerProgram: PUMP_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(remainingAccounts)
  .instruction();
tx.add(burnIx);

try {
  const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  console.log("✓ burn_from_curve confirmed:", sig);

  const lc = await (program.account as any).launchConfig.fetch(launchConfig);
  console.log("\n[*] launch state after crank:");
  console.log("  cumulativeCurveSolSpent:", lc.cumulativeCurveSolSpent.toString());
  console.log("  cumulativeTokensBurned: ", lc.cumulativeTokensBurned.toString());
  console.log("  curveBurnCount:         ", lc.curveBurnCount.toString());
} catch (e: any) {
  console.error("\n✗ burn_from_curve FAILED");
  console.error("  ", e?.message ?? e);
  if (e?.logs) {
    console.error("  logs:");
    for (const l of e.logs) console.error("   ", l);
  }
  process.exit(1);
}
