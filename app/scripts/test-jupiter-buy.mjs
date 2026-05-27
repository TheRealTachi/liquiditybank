#!/usr/bin/env node
/**
 * Diagnostic: buy our test token via Jupiter swap v6 from the admin wallet.
 * If this succeeds, we know Jupiter knows the correct pump.fun v2 calling
 * convention and our upgrade-to-Jupiter-CPI path will work.
 *
 * Spends 0.05 SOL. Tokens go to admin wallet (not incinerated).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const mint = process.argv[2];
if (!mint) {
  console.error("usage: node scripts/test-jupiter-buy.mjs <mint>");
  process.exit(1);
}

const admin = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/id.json"), "utf8"))
  )
);

console.log(`Buyer: ${admin.publicKey.toBase58()}`);
console.log(`Output mint: ${mint}`);
console.log(`Amount: 0.05 SOL\n`);

// 1. Quote
const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
quoteUrl.searchParams.set("inputMint", "So11111111111111111111111111111111111111112");
quoteUrl.searchParams.set("outputMint", mint);
quoteUrl.searchParams.set("amount", "50000000");
quoteUrl.searchParams.set("slippageBps", "500");
const quoteRes = await fetch(quoteUrl);
const quote = await quoteRes.json();
if (!quote.routePlan?.length) {
  console.error("no route:", JSON.stringify(quote, null, 2));
  process.exit(1);
}
console.log(`Quote: ${quote.inAmount} → ${quote.outAmount} via ${quote.routePlan[0].swapInfo.label}\n`);

// 2. Build the swap tx
const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: admin.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  }),
});
const swap = await swapRes.json();
if (!swap.swapTransaction) {
  console.error("swap build failed:", JSON.stringify(swap, null, 2));
  process.exit(1);
}

// 3. Decode + sign + send
const buf = Buffer.from(swap.swapTransaction, "base64");
const tx = VersionedTransaction.deserialize(buf);
tx.sign([admin]);

const conn = new Connection(RPC, "confirmed");
try {
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  console.log(`Submitted: ${sig}`);
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK https://solscan.io/tx/${sig}`);
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
