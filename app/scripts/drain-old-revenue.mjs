#!/usr/bin/env node
/**
 * Drain the OLD program's protocol_revenue PDA back to the admin wallet,
 * before closing the program. Once the program is closed, the PDA's lamports
 * are stranded forever — only this instruction can move them.
 *
 * Usage:
 *   node scripts/drain-old-revenue.mjs              # dry-run
 *   node scripts/drain-old-revenue.mjs --execute    # actually send
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

const PROGRAM_ID = new PublicKey("LiqsdMHNBjXJt5XHjRq7f4H8tDwcBu4yj2cuUv6MNYi");
const ADMIN_KEYPAIR_PATH = path.join(homedir(), ".config/solana/id.json");

const execute = process.argv.includes("--execute");

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPAIR_PATH, "utf8")))
);
const [protocolConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-config")],
  PROGRAM_ID
);
const [protocolRevenue] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-revenue")],
  PROGRAM_ID
);

const conn = new Connection(RPC, "confirmed");
const balance = await conn.getBalance(protocolRevenue);

console.log(`RPC:             ${RPC}`);
console.log(`Admin:           ${admin.publicKey.toBase58()}`);
console.log(`protocol_config:  ${protocolConfig.toBase58()}`);
console.log(`protocol_revenue: ${protocolRevenue.toBase58()}`);
console.log(`Balance:         ${balance} lamports (${(balance / 1e9).toFixed(6)} SOL)`);
console.log(`Mode:            ${execute ? "EXECUTE" : "dry-run"}`);
console.log("");

if (balance === 0) {
  console.log("Nothing to drain.");
  process.exit(0);
}

// admin_collect_revenue discriminator from IDL
// (Anchor: sha256("global:admin_collect_revenue")[0..8])
const idl = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "lib/liquiditybank.idl.json"),
    "utf8"
  )
);
const ix = idl.instructions.find((i) => i.name === "admin_collect_revenue" || i.name === "adminCollectRevenue");
if (!ix) {
  console.error("admin_collect_revenue not found in IDL");
  process.exit(1);
}
const disc = Buffer.from(ix.discriminator);

// args: u64 lamports (little-endian)
const lamportsArg = Buffer.alloc(8);
lamportsArg.writeBigUInt64LE(BigInt(balance), 0);

const data = Buffer.concat([disc, lamportsArg]);

const instruction = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: protocolRevenue, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: false, isWritable: true }, // destination
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

console.log("Will send:", balance, "lamports to", admin.publicKey.toBase58());

if (!execute) {
  console.log("Re-run with --execute to actually send.");
  process.exit(0);
}

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
const tx = new Transaction().add(instruction);
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = admin.publicKey;
tx.sign(admin);

try {
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK  tx=${sig}`);
} catch (e) {
  console.error(`FAIL: ${e?.message ?? e}`);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
