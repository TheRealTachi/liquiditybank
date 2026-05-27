#!/usr/bin/env node
/**
 * Call pump.fun's init_user_volume_accumulator for a given user.
 * Admin pays rent + tx fees; user can be any pubkey (no signature needed).
 *
 * Usage: node scripts/init-user-vol-acc.mjs <user_pubkey> [--execute]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
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

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const INIT_DISC = Buffer.from([94, 6, 202, 115, 255, 96, 232, 183]);

const userArg = process.argv[2];
if (!userArg) {
  console.error("usage: node scripts/init-user-vol-acc.mjs <user_pubkey> [--execute]");
  process.exit(1);
}
const execute = process.argv.includes("--execute");
const user = new PublicKey(userArg);

const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/id.json"), "utf8"))
  )
);

const [userVolAccum] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_volume_accumulator"), user.toBuffer()],
  PUMP_PROGRAM_ID
);
const [eventAuth] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_PROGRAM_ID
);

const ix = new TransactionInstruction({
  programId: PUMP_PROGRAM_ID,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: userVolAccum, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuth, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: INIT_DISC,
});

const conn = new Connection(RPC, "confirmed");

console.log(`Payer:                   ${payer.publicKey.toBase58()}`);
console.log(`User (fee_owner):        ${user.toBase58()}`);
console.log(`user_volume_accumulator: ${userVolAccum.toBase58()}`);

const existing = await conn.getAccountInfo(userVolAccum);
if (existing) {
  console.log("Already initialized. Nothing to do.");
  process.exit(0);
}

if (!execute) {
  console.log("(dry-run; pass --execute to send)");
  process.exit(0);
}

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
const tx = new Transaction().add(ix);
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = payer.publicKey;
tx.sign(payer);

try {
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK  tx=${sig}`);
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
