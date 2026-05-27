/**
 * One-time protocol bootstrap. Calls `initialize_protocol` to create the
 * protocol_config and protocol_revenue PDAs.
 *
 * Usage:
 *   PROGRAM_ID=... RPC_URL=... KEYPAIR=~/.config/solana/id.json \
 *     pnpm tsx scripts/init-protocol.ts
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
  protocolConfigPda,
  protocolRevenuePda,
} from "../lib/programs.js";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());

const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));

const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(admin);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const program = new Program(idl as any, provider);

const [protocolConfig] = protocolConfigPda();
const [protocolRevenue] = protocolRevenuePda();

console.log("program:           ", LIQUIDITYBANK_PROGRAM_ID.toBase58());
console.log("admin:             ", admin.publicKey.toBase58());
console.log("rpc:               ", RPC);
console.log("protocol_config:   ", protocolConfig.toBase58());
console.log("protocol_revenue:  ", protocolRevenue.toBase58());

const existing = await connection.getAccountInfo(protocolConfig);
if (existing) {
  console.log("\nprotocol_config already initialized. Skipping.");
  process.exit(0);
}

const sig = await program.methods
  .initializeProtocol()
  .accounts({
    admin: admin.publicKey,
    protocolConfig,
    protocolRevenue,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log("\ninitialize_protocol:", sig);
console.log("done.");
