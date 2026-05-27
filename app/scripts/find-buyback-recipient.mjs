#!/usr/bin/env node
/**
 * Find the buyback_fee_recipient + its ATA by inspecting a recent successful
 * buy_exact_sol_in tx on the bonding curve. pump.fun's discriminator for
 * buy_exact_sol_in is [56, 252, 116, 8, 158, 223, 205, 95].
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]).toString("hex");

const bondingCurve = new PublicKey(process.argv[2]);
const conn = new Connection(RPC, "confirmed");

const sigs = await conn.getSignaturesForAddress(bondingCurve, { limit: 20 });
console.log(`Found ${sigs.length} recent txs on ${bondingCurve.toBase58()}`);

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
  const ixs = msg.compiledInstructions ?? msg.instructions;
  for (const ix of ixs) {
    const programId = allKeys[ix.programIdIndex];
    if (!programId.equals(PUMP_PROGRAM_ID)) continue;
    const data =
      ix.data instanceof Uint8Array
        ? Buffer.from(ix.data).toString("hex")
        : Buffer.from(ix.data, "base64").toString("hex");
    if (!data.startsWith(BUY_EXACT_SOL_IN)) continue;
    console.log(`\nbuy_exact_sol_in @ tx ${s.signature}`);
    console.log("Accounts:");
    const indexes = ix.accountKeyIndexes ?? ix.accounts;
    indexes.forEach((idx, i) => {
      console.log(`  ${i.toString().padStart(2)}: ${allKeys[idx].toBase58()}`);
    });
    process.exit(0);
  }
}
console.log("No buy_exact_sol_in tx found in the last 20 txs on this curve.");
