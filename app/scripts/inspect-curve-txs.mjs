#!/usr/bin/env node
/**
 * Inspect recent pump.fun instructions on a bonding curve — show
 * discriminator + account list for each pump.fun ix in recent txs.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const KNOWN = {
  "1817566bc61cdb84": "collect_creator_fee (legacy)",
  "cf118af204221338": "collect_creator_fee (v2)",
  "180e8a82e9b6b1a8": "create",
  "66063d121adaebea": "buy (legacy)",
  "33e685a4017f83ad": "sell (legacy)",
  "38fc740809dfcd5f": "buy_exact_sol_in",
  "ddbd9bd0c9b9ce17": "sell_exact_sol_out",
};

const bondingCurve = new PublicKey(process.argv[2]);
const conn = new Connection(RPC, "confirmed");

const sigs = await conn.getSignaturesForAddress(bondingCurve, { limit: 15 });
console.log(`Found ${sigs.length} recent txs.`);

let found = 0;
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

  // Look at top-level + inner instructions
  const topIxs = msg.compiledInstructions ?? msg.instructions;
  const innerSets = tx.meta?.innerInstructions ?? [];

  const inspect = (ix, where) => {
    const programId = allKeys[ix.programIdIndex];
    if (!programId.equals(PUMP_PROGRAM_ID)) return false;
    const data =
      ix.data instanceof Uint8Array
        ? Buffer.from(ix.data)
        : Buffer.from(ix.data, "base64");
    const disc = data.subarray(0, 8).toString("hex");
    const name = KNOWN[disc] ?? `unknown(${disc})`;
    console.log(`\n[${where}] tx=${s.signature.slice(0, 16)}...  ix=${name}`);
    const indexes = ix.accountKeyIndexes ?? ix.accounts;
    indexes.forEach((idx, i) => {
      console.log(`  ${i.toString().padStart(2)}: ${allKeys[idx].toBase58()}`);
    });
    return true;
  };

  topIxs.forEach((ix, i) => inspect(ix, `top.${i}`) && found++);
  innerSets.forEach((set) => {
    set.instructions.forEach((ix, i) => inspect(ix, `inner.${set.index}.${i}`) && found++);
  });

  if (found >= 2) break;
}

if (!found) console.log("\nNo pump.fun instructions found.");
