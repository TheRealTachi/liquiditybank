#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const [pumpGlobal] = PublicKey.findProgramAddressSync(
  [Buffer.from("global")],
  PUMP_PROGRAM_ID
);
const conn = new Connection(RPC, "confirmed");
const info = await conn.getAccountInfo(pumpGlobal);
if (!info) throw new Error("global not found");
const d = info.data;

console.log(`global account size: ${d.length}`);
let off = 8; // anchor disc
const initialized = d[off]; off += 1;
const authority = new PublicKey(d.subarray(off, off + 32)); off += 32;
const fee_recipient = new PublicKey(d.subarray(off, off + 32)); off += 32;
off += 5 * 8; // 5 u64s: 4 reserves/supply + fee_basis_points
const withdraw_authority = new PublicKey(d.subarray(off, off + 32)); off += 32;
off += 1; // enable_migrate
off += 8; // pool_migration_fee
off += 8; // creator_fee_basis_points
const fee_recipients = [];
for (let i = 0; i < 7; i++) {
  fee_recipients.push(new PublicKey(d.subarray(off, off + 32)));
  off += 32;
}
const set_creator_authority = new PublicKey(d.subarray(off, off + 32)); off += 32;
const admin_set_creator_authority = new PublicKey(d.subarray(off, off + 32)); off += 32;
off += 1; // create_v2_enabled
const whitelist_pda = new PublicKey(d.subarray(off, off + 32)); off += 32;
const reserved_fee_recipient = new PublicKey(d.subarray(off, off + 32)); off += 32;
off += 1; // mayhem_mode_enabled
const reserved_fee_recipients = [];
for (let i = 0; i < 7; i++) {
  reserved_fee_recipients.push(new PublicKey(d.subarray(off, off + 32)));
  off += 32;
}
const is_cashback_enabled = d[off]; off += 1;
console.log(`buyback_fee_recipients offset: ${off}`);
const buyback_fee_recipients = [];
for (let i = 0; i < 8; i++) {
  buyback_fee_recipients.push(new PublicKey(d.subarray(off, off + 32)));
  off += 32;
}
const buyback_basis_points = d.readBigUInt64LE(off); off += 8;

console.log(`initialized: ${initialized}`);
console.log(`authority: ${authority.toBase58()}`);
console.log(`fee_recipient: ${fee_recipient.toBase58()}`);
console.log(`withdraw_authority: ${withdraw_authority.toBase58()}`);
console.log(`is_cashback_enabled: ${is_cashback_enabled}`);
console.log(`buyback_basis_points: ${buyback_basis_points}`);
console.log(`buyback_fee_recipients:`);
buyback_fee_recipients.forEach((p, i) => {
  const zero = p.toBase58() === "11111111111111111111111111111111";
  console.log(`  [${i}]: ${p.toBase58()}${zero ? " (zero)" : ""}`);
});
console.log(`fee_recipients (primary):`);
fee_recipients.forEach((p, i) => {
  const zero = p.toBase58() === "11111111111111111111111111111111";
  console.log(`  [${i}]: ${p.toBase58()}${zero ? " (zero)" : ""}`);
});
