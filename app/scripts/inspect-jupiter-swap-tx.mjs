#!/usr/bin/env node
/**
 * Fetch Jupiter's full swap tx and decompose it — find which ALTs it uses
 * and what the inner Jupiter ix accounts/data look like after ALT lookup.
 */
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";

const RPC = process.env.HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");

const mint = "Ccpxjc29z47L8TiV95p8ffViMCEkj2s8eHucw3nqdnJj";
const fakeUser = "EUEPFC953FQcW6vkaYmnWHtrSkgoEVHHmMyyUYfpARen"; // fee_owner

const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
quoteUrl.searchParams.set("inputMint", "So11111111111111111111111111111111111111112");
quoteUrl.searchParams.set("outputMint", mint);
quoteUrl.searchParams.set("amount", "499000000");
quoteUrl.searchParams.set("slippageBps", "500");
const quote = await (await fetch(quoteUrl)).json();

const swap = await (
  await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: fakeUser,
      wrapAndUnwrapSol: false,
      useSharedAccounts: false,
    }),
  })
).json();

const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
const msg = tx.message;
console.log("ALTs referenced by tx:", msg.addressTableLookups.map((l) => l.accountKey.toBase58()));
console.log("Static account keys:", msg.staticAccountKeys.length);
for (const l of msg.addressTableLookups) {
  console.log(`  ALT ${l.accountKey.toBase58()}: ${l.writableIndexes.length} writable + ${l.readonlyIndexes.length} readonly`);
}
console.log("Total tx size (bytes):", tx.serialize().length);
