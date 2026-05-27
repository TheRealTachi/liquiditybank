#!/usr/bin/env node
/**
 * One-shot: call initialize_protocol on the freshly deployed program.
 * Creates the protocol_config + protocol_revenue PDAs. Run once per
 * deployment, before any register_launch can succeed.
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

const admin = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/id.json"), "utf8"))
  )
);

const [protocolConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-config")],
  PROGRAM_ID
);
const [protocolRevenue] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol-revenue")],
  PROGRAM_ID
);

const initIx = idl.instructions.find(
  (i) => i.name === "initialize_protocol" || i.name === "initializeProtocol"
);
if (!initIx) throw new Error("initialize_protocol not in IDL");
const data = Buffer.from(initIx.discriminator);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: protocolConfig, isSigner: false, isWritable: true },
    { pubkey: protocolRevenue, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const conn = new Connection(RPC, "confirmed");

console.log(`Program ID:       ${PROGRAM_ID.toBase58()}`);
console.log(`Admin:            ${admin.publicKey.toBase58()}`);
console.log(`protocol_config:  ${protocolConfig.toBase58()}`);
console.log(`protocol_revenue: ${protocolRevenue.toBase58()}`);
console.log("");

const existing = await conn.getAccountInfo(protocolConfig);
if (existing) {
  console.log("protocol_config already initialized. Skipping.");
  process.exit(0);
}

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
const tx = new Transaction().add(ix);
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = admin.publicKey;
tx.sign(admin);

try {
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK  tx=${sig}`);
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
