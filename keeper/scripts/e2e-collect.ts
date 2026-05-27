/**
 * Verify the collect_curve_fees CPI shape by calling it against a
 * freshly launched mint. Without real trades there are no fees to
 * collect, so we expect either:
 *
 *   - Success with zero balance change (CPI shape is correct, just nothing to claim)
 *   - A specific pump.fun error code indicating "no fees" (still valid)
 *
 * What we want to catch is any "account does not exist" / "invalid account data"
 * error — that would mean we got the account ORDER wrong in the CPI.
 *
 * Usage:
 *   MINT=<mint from e2e-launch.ts> npx tsx scripts/e2e-collect.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

import idl from "../../target/idl/liquiditybank.json" with { type: "json" };
import {
  LIQUIDITYBANK_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  feeOwnerPda,
  launchConfigPda,
  pumpCreatorVaultPda,
  pumpEventAuthorityPda,
} from "../lib/programs.js";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const MINT_STR = process.env.MINT;
if (!MINT_STR) {
  console.error("Set MINT env var to the mint address from e2e-launch.ts");
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

const [feeOwner] = feeOwnerPda(mint);
const [launchConfig] = launchConfigPda(mint);
const [creatorVault] = pumpCreatorVaultPda(feeOwner);
const [pumpEventAuthority] = pumpEventAuthorityPda();

console.log("collect_curve_fees test");
console.log("  mint:               ", mint.toBase58());
console.log("  fee_owner:          ", feeOwner.toBase58());
console.log("  launch_config:      ", launchConfig.toBase58());
console.log("  creator_vault:      ", creatorVault.toBase58());
console.log("  pump_event_authority:", pumpEventAuthority.toBase58());
console.log();

const feeOwnerBefore =
  (await connection.getAccountInfo(feeOwner))?.lamports ?? 0;

try {
  const sig = await program.methods
    .collectCurveFees()
    .accounts({
      cranker: cranker.publicKey,
      mint,
      launchConfig,
      feeOwner,
      creatorVault,
      pumpEventAuthority,
      pumpProgram: PUMP_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("✓ tx confirmed:", sig);

  const feeOwnerAfter =
    (await connection.getAccountInfo(feeOwner))?.lamports ?? 0;
  const delta = feeOwnerAfter - feeOwnerBefore;
  console.log("✓ fee_owner lamport delta:", delta);

  if (delta > 0) {
    console.log("\nThere were actual creator fees to collect (suggests real trades happened).");
  } else {
    console.log(
      "\nZero delta — no fees yet (expected without trades). CPI shape is correct."
    );
  }
} catch (e: any) {
  console.error("\n✗ collect_curve_fees FAILED");
  console.error("  ", e?.message ?? e);
  if (e?.logs) {
    console.error("  logs:");
    for (const l of e.logs) console.error("   ", l);
  }
  process.exit(1);
}
