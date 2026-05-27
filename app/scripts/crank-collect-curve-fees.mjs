#!/usr/bin/env node
/**
 * Call collect_curve_fees on the program. Permissionless: anyone can run it.
 * Moves accumulated creator-fee SOL out of pump.fun's creator_vault into
 * our fee_owner PDA, and increments launch_config.cumulative_fees_collected.
 *
 * Usage:
 *   node scripts/crank-collect-curve-fees.mjs <mint>             # dry-run / preview
 *   node scripts/crank-collect-curve-fees.mjs <mint> --execute   # actually send
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

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
  console.error("usage: node scripts/crank-collect-curve-fees.mjs <mint> [--execute]");
  process.exit(1);
}
const execute = process.argv.includes("--execute");
const mint = new PublicKey(mintArg);

// Cranker keypair: defaults to ~/.config/solana/liquiditybank-cranker.json (the
// "Liq…" vanity wallet). Falls back to id.json if the dedicated cranker
// isn't installed yet.
const CRANKER_PATH = process.env.CRANKER_KEYPAIR
  ?? path.join(homedir(), ".config/solana/liquiditybank-cranker.json");
const FALLBACK_PATH = path.join(homedir(), ".config/solana/id.json");
function loadCranker() {
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(CRANKER_PATH, "utf8")))
    );
  } catch {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(FALLBACK_PATH, "utf8")))
    );
  }
}
const cranker = loadCranker();

const [feeOwner] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee-owner"), mint.toBuffer()],
  PROGRAM_ID
);
const [launchConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("launch-config"), mint.toBuffer()],
  PROGRAM_ID
);
const [creatorVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("creator-vault"), feeOwner.toBuffer()],
  PUMP_PROGRAM_ID
);
const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_PROGRAM_ID
);

const cci = idl.instructions.find(
  (i) => i.name === "collect_curve_fees" || i.name === "collectCurveFees"
);
if (!cci) throw new Error("collect_curve_fees not in IDL");
const data = Buffer.from(cci.discriminator);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: launchConfig, isSigner: false, isWritable: true },
    { pubkey: feeOwner, isSigner: false, isWritable: true },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const conn = new Connection(RPC, "confirmed");

const [cvBefore, foBefore] = await Promise.all([
  conn.getBalance(creatorVault),
  conn.getBalance(feeOwner),
]);

console.log(`Program:        ${PROGRAM_ID.toBase58()}`);
console.log(`Mint:           ${mint.toBase58()}`);
console.log(`Cranker:        ${cranker.publicKey.toBase58()}`);
console.log(`fee_owner:      ${feeOwner.toBase58()}`);
console.log(`creator_vault:  ${creatorVault.toBase58()}`);
console.log(`pump_event_auth:${pumpEventAuthority.toBase58()}`);
console.log("");
console.log("BEFORE:");
console.log(`  creator_vault: ${cvBefore} lamports (${(cvBefore / 1e9).toFixed(6)} SOL)`);
console.log(`  fee_owner:     ${foBefore} lamports (${(foBefore / 1e9).toFixed(6)} SOL)`);
console.log("");

if (!execute) {
  console.log("(dry-run; pass --execute to actually call collect_curve_fees)");
  process.exit(0);
}

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
const tx = new Transaction().add(ix);
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = cranker.publicKey;
tx.sign(cranker);

try {
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK  tx=${sig}`);
  console.log(`    https://solscan.io/tx/${sig}`);
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}

const [cvAfter, foAfter] = await Promise.all([
  conn.getBalance(creatorVault),
  conn.getBalance(feeOwner),
]);
console.log("");
console.log("AFTER:");
console.log(`  creator_vault: ${cvAfter} lamports (${(cvAfter / 1e9).toFixed(6)} SOL)`);
console.log(`  fee_owner:     ${foAfter} lamports (${(foAfter / 1e9).toFixed(6)} SOL)`);
const delta = foAfter - foBefore;
console.log(`  → fee_owner gained: ${delta} lamports (${(delta / 1e9).toFixed(6)} SOL)`);
