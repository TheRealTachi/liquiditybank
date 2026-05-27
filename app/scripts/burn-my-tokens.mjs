#!/usr/bin/env node
/**
 * Direct SPL Burn from the admin wallet — reduces mint.supply on chain.
 * Used to clean up the 1.76M tokens we ended up with from the diagnostic
 * Jupiter test buy.
 *
 * Usage: node scripts/burn-my-tokens.mjs <mint> [--execute]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SPL_TOKEN_BURN_IX = 8;

const mintArg = process.argv[2];
if (!mintArg) {
  console.error("usage: node scripts/burn-my-tokens.mjs <mint> [--execute]");
  process.exit(1);
}
const execute = process.argv.includes("--execute");
const mint = new PublicKey(mintArg);

const owner = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/id.json"), "utf8"))
  )
);

const [ata] = PublicKey.findProgramAddressSync(
  [owner.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID
);

const conn = new Connection(RPC, "confirmed");

const balRes = await conn.getTokenAccountBalance(ata);
const amount = BigInt(balRes.value.amount);
console.log(`Owner: ${owner.publicKey.toBase58()}`);
console.log(`Mint:  ${mint.toBase58()}`);
console.log(`ATA:   ${ata.toBase58()}`);
console.log(`Balance to burn: ${balRes.value.uiAmountString} tokens (raw: ${amount})`);

const supplyBefore = await conn.getTokenSupply(mint);
console.log(`Mint.supply BEFORE: ${supplyBefore.value.uiAmountString}`);

if (amount === 0n) {
  console.log("Nothing to burn.");
  process.exit(0);
}

if (!execute) {
  console.log("\n(dry-run; --execute to send)");
  process.exit(0);
}

const data = Buffer.concat([
  Buffer.from([SPL_TOKEN_BURN_IX]),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(amount, 0); return b; })(),
]);

const ix = new TransactionInstruction({
  programId: TOKEN_PROGRAM_ID,
  keys: [
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: true, isWritable: false },
  ],
  data,
});

const { blockhash } = await conn.getLatestBlockhash();
const tx = new Transaction().add(ix);
tx.recentBlockhash = blockhash;
tx.feePayer = owner.publicKey;
tx.sign(owner);

try {
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK  tx=${sig}`);
  console.log(`    https://solscan.io/tx/${sig}`);
  const supplyAfter = await conn.getTokenSupply(mint);
  console.log(`Mint.supply AFTER:  ${supplyAfter.value.uiAmountString}`);
  const delta = BigInt(supplyBefore.value.amount) - BigInt(supplyAfter.value.amount);
  console.log(`Supply reduced by: ${delta} raw units (${(Number(delta) / 10 ** supplyBefore.value.decimals)} tokens)`);
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
