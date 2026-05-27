#!/usr/bin/env node
/**
 * Sweep SOL out of stuck launch-session keypairs back to a destination wallet.
 *
 * Usage:
 *   node scripts/sweep-sessions.mjs <destination_pubkey>              # dry-run
 *   node scripts/sweep-sessions.mjs <destination_pubkey> --execute    # actually send
 *
 * Reads every .liquiditybank-sessions/*.json, decodes the session keypair, checks
 * its on-chain balance, and (with --execute) sends (balance - tx_fee) to the
 * destination. Sessions with zero balance are skipped silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const SESSIONS_DIR = path.join(process.cwd(), ".liquiditybank-sessions");
const TX_FEE_BUFFER = 5_000; // single-signature tx fee on Solana

const [, , destArg, ...flags] = process.argv;
if (!destArg) {
  console.error("usage: node scripts/sweep-sessions.mjs <destination_pubkey> [--execute]");
  process.exit(1);
}
const destination = new PublicKey(destArg);
const execute = flags.includes("--execute");

const connection = new Connection(RPC, "confirmed");

console.log(`RPC:         ${RPC}`);
console.log(`Destination: ${destination.toBase58()}`);
console.log(`Mode:        ${execute ? "EXECUTE (will send tx)" : "dry-run"}`);
console.log("");

let files;
try {
  files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
} catch {
  console.error(`No sessions dir at ${SESSIONS_DIR}`);
  process.exit(1);
}

let totalRecoverable = 0;
for (const f of files) {
  const raw = readFileSync(path.join(SESSIONS_DIR, f), "utf8");
  const r = JSON.parse(raw);
  const kp = Keypair.fromSecretKey(bs58.decode(r.secretBase58));
  const balance = await connection.getBalance(kp.publicKey);

  if (balance === 0) {
    console.log(`  ${r.id}  ${kp.publicKey.toBase58()}  balance=0  (skip)`);
    continue;
  }

  const sendable = balance - TX_FEE_BUFFER;
  if (sendable <= 0) {
    console.log(`  ${r.id}  ${kp.publicKey.toBase58()}  balance=${balance} (< tx fee, skip)`);
    continue;
  }

  totalRecoverable += sendable;
  console.log(`  ${r.id}  ${kp.publicKey.toBase58()}`);
  console.log(`    name=${r.name} symbol=${r.symbol} error=${r.error ?? "(none)"}`);
  console.log(`    balance=${balance} lamports (${(balance / 1e9).toFixed(6)} SOL)`);
  console.log(`    will send=${sendable} lamports (${(sendable / 1e9).toFixed(6)} SOL)`);

  if (execute) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: destination,
        lamports: sendable,
      })
    );
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    try {
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`    OK  tx=${sig}`);
    } catch (e) {
      console.error(`    FAIL  ${e?.message ?? e}`);
    }
  }
}

console.log("");
console.log(
  `Total ${execute ? "swept" : "recoverable"}: ${totalRecoverable} lamports (${(totalRecoverable / 1e9).toFixed(6)} SOL)`
);
if (!execute && totalRecoverable > 0) {
  console.log("Re-run with --execute to actually send.");
}
