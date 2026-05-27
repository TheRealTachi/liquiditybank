#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const KNOWN = {
  "b817ee6167c5d33d": "buy_v2",
  "c2ab1c46684d5b2f": "buy_exact_quote_in_v2",
  "66063d121adaebea": "buy (legacy)",
  "38fc740809dfcd5f": "buy_exact_sol_in (legacy)",
  "5df6823ce7e940b2": "sell_v2",
  "33e685a4017f83ad": "sell (legacy)",
};

const bondingCurve = new PublicKey(process.argv[2]);
const conn = new Connection(RPC, "confirmed");

const sigs = await conn.getSignaturesForAddress(bondingCurve, { limit: 50 });
console.log(`Scanning ${sigs.length} recent txs on ${bondingCurve.toBase58()}`);

for (const s of sigs) {
  if (s.err) continue;
  const tx = await conn.getTransaction(s.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) continue;
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys ?? msg.accountKeys;
  const allKeys = [
    ...keys,
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ];
  const topIxs = msg.compiledInstructions ?? msg.instructions;
  const innerSets = tx.meta?.innerInstructions ?? [];

  const check = (ix, where) => {
    const programId = allKeys[ix.programIdIndex];
    if (!programId.equals(PUMP_PROGRAM_ID)) return false;
    const data =
      ix.data instanceof Uint8Array
        ? Buffer.from(ix.data)
        : Buffer.from(ix.data, "base64");
    const disc = data.subarray(0, 8).toString("hex");
    const name = KNOWN[disc];
    if (!name || !name.startsWith("buy")) return false;
    console.log(`\n=== ${name} @ tx ${s.signature} (${where}) ===`);
    const indexes = ix.accountKeyIndexes ?? ix.accounts;
    indexes.forEach((idx, i) => {
      console.log(`  ${i.toString().padStart(2)}: ${allKeys[idx].toBase58()}`);
    });
    console.log(`  data: ${data.toString("hex")}`);
    return true;
  };

  let found = false;
  topIxs.forEach((ix, i) => { if (check(ix, `top.${i}`)) found = true; });
  innerSets.forEach((set) => {
    set.instructions.forEach((ix, i) => { if (check(ix, `inner.${set.index}.${i}`)) found = true; });
  });
  if (found) process.exit(0);
}
console.log("\nNo buy_v2/buy_exact_quote_in_v2/legacy-buy found in 50 recent txs.");
