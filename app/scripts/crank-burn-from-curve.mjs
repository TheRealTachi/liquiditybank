#!/usr/bin/env node
/**
 * burn_from_curve crank (router edition).
 *
 * Flow:
 *   1. Pre-create fee_owner's WSOL ATA + base-token ATA + incinerator ATA
 *   2. Fetch a Jupiter swap-instruction with userPublicKey = fee_owner
 *   3. Extract Jupiter's ix data + accounts + per-account flags
 *   4. Call our program's burn_from_curve with router_program = Jupiter v6
 *      and the route accounts as remaining_accounts
 *
 * Our on-chain code: wraps fee_owner's bare SOL → WSOL, CPIs Jupiter (signing
 * for fee_owner), then transfers tokens to incinerator and pays the cranker.
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
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const idl = JSON.parse(
  readFileSync(path.join(process.cwd(), "lib/liquiditybank.idl.json"), "utf8")
);
const PROGRAM_ID = new PublicKey(idl.address);
const JUPITER_V6 = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");

const SLIPPAGE_BPS = 500; // 5%

const mintArg = process.argv[2];
if (!mintArg) {
  console.error("usage: node scripts/crank-burn-from-curve.mjs <mint> [--execute]");
  process.exit(1);
}
const execute = process.argv.includes("--execute");
const mint = new PublicKey(mintArg);

// Cranker keypair: defaults to ~/.config/solana/liquiditybank-cranker.json (the
// "Liq…" vanity wallet that signs all cranks). Falls back to id.json if the
// dedicated cranker isn't installed yet.
const CRANKER_PATH = process.env.CRANKER_KEYPAIR
  ?? path.join(homedir(), ".config/solana/liquiditybank-cranker.json");
const FALLBACK_PATH = path.join(homedir(), ".config/solana/id.json");
function loadCranker() {
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(CRANKER_PATH, "utf8")))
    );
  } catch {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(FALLBACK_PATH, "utf8")))
    );
  }
}
const cranker = loadCranker();

const [feeOwner] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee-owner"), mint.toBuffer()],
  PROGRAM_ID
);
const [launchConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("launch-config"), mint.toBuffer()],
  PROGRAM_ID
);

function ata(owner, m, tp = TOKEN_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tp.toBuffer(), m.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

const feeOwnerTokenAta = ata(feeOwner, mint);
const feeOwnerWsolAta = ata(feeOwner, NATIVE_MINT);

const conn = new Connection(RPC, "confirmed");

const [foBal, foTok, foWsol] = await Promise.all([
  conn.getBalance(feeOwner),
  conn.getAccountInfo(feeOwnerTokenAta),
  conn.getAccountInfo(feeOwnerWsolAta),
]);

console.log(`Program:        ${PROGRAM_ID.toBase58()}`);
console.log(`Cranker:        ${cranker.publicKey.toBase58()}`);
console.log(`fee_owner:      ${feeOwner.toBase58()}`);
console.log(`fee_owner_tok:  ${feeOwnerTokenAta.toBase58()}  ${foTok ? "(exists)" : "(missing)"}`);
console.log(`fee_owner_wsol: ${feeOwnerWsolAta.toBase58()}  ${foWsol ? "(exists)" : "(missing)"}`);
console.log(`fee_owner SOL:  ${foBal} lamports (${(foBal / 1e9).toFixed(6)} SOL)`);
console.log("");

if (foBal < 500_000_000) {
  console.log(`✗ Below CRANK_THRESHOLD (0.5 SOL).`);
  process.exit(1);
}

// Compute spend the same way the on-chain code does
const RESERVE = 10_000_000n; // FEE_OWNER_RESERVE_LAMPORTS
const REWARD = 1_000_000n; // CRANK_REWARD_LAMPORTS
const spend = BigInt(foBal) - RESERVE - REWARD;
console.log(`Will spend on Jupiter: ${spend} lamports (${(Number(spend) / 1e9).toFixed(6)} SOL)`);

// ---------- Fetch Jupiter quote + swap-instructions ----------
const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
quoteUrl.searchParams.set("inputMint", NATIVE_MINT.toBase58());
quoteUrl.searchParams.set("outputMint", mint.toBase58());
quoteUrl.searchParams.set("amount", spend.toString());
quoteUrl.searchParams.set("slippageBps", String(SLIPPAGE_BPS));
const quote = await (await fetch(quoteUrl)).json();
if (!quote.routePlan?.length) {
  console.error("no Jupiter route:", JSON.stringify(quote).slice(0, 500));
  process.exit(1);
}
console.log(`Jupiter quote: ${quote.inAmount} → ${quote.outAmount} via ${quote.routePlan.map(r => r.swapInfo.label).join(" → ")}`);

const swapIxsRes = await fetch("https://lite-api.jup.ag/swap/v1/swap-instructions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: feeOwner.toBase58(),
    wrapAndUnwrapSol: false, // we wrap inside our program already
    useSharedAccounts: false,
  }),
});
const swapIxs = await swapIxsRes.json();
if (!swapIxs.swapInstruction) {
  console.error("swap-instructions failed:", JSON.stringify(swapIxs).slice(0, 1000));
  process.exit(1);
}
const jup = swapIxs.swapInstruction;
console.log(`Jupiter swap ix: ${jup.accounts.length} accounts, ${Buffer.from(jup.data, "base64").length} bytes data`);
console.log(`Address lookup tables: ${(swapIxs.addressLookupTableAddresses ?? []).length}`);

if ((swapIxs.addressLookupTableAddresses ?? []).length > 0) {
  console.log("⚠ Jupiter route uses Address Lookup Tables — we'll need to attach them to the tx.");
}

// Build remaining_accounts list + flag bytes from Jupiter's ix accounts
const routerData = Buffer.from(jup.data, "base64");
const remainingAccounts = jup.accounts.map((a) => ({
  pubkey: new PublicKey(a.pubkey),
  isSigner: a.isSigner,
  isWritable: a.isWritable,
}));
const flags = Buffer.from(
  remainingAccounts.map((a) => (a.isWritable ? 1 : 0) | (a.isSigner ? 2 : 0))
);

// ---------- Build our burn_from_curve ix ----------
const bfc = idl.instructions.find(
  (i) => i.name === "burn_from_curve" || i.name === "burnFromCurve"
);
if (!bfc) throw new Error("burn_from_curve not in IDL");

function encVecU8(b) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}
const data = Buffer.concat([
  Buffer.from(bfc.discriminator),
  encVecU8(routerData),
  encVecU8(flags),
  Buffer.alloc(8), // min_tokens_out = 0
]);

const burnIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true }, // mut: SPL Burn decrements supply
    { pubkey: launchConfig, isSigner: false, isWritable: true },
    { pubkey: feeOwner, isSigner: false, isWritable: true },
    { pubkey: feeOwnerTokenAta, isSigner: false, isWritable: true },
    { pubkey: feeOwnerWsolAta, isSigner: false, isWritable: true },
    { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
    { pubkey: JUPITER_V6, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining_accounts: Jupiter's route accounts in original order
    ...remainingAccounts.map((a) => ({
      pubkey: a.pubkey,
      // strip signer flag from outer keys — our on-chain code re-applies based on flags arg
      isSigner: false,
      isWritable: a.isWritable,
    })),
  ],
  data,
});

function createAtaIx(payer, ataAddr, owner, m) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ataAddr, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: m, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // createIdempotent
  });
}

const setupIxs = [];
if (!foTok) setupIxs.push(createAtaIx(cranker.publicKey, feeOwnerTokenAta, feeOwner, mint));
if (!foWsol) setupIxs.push(createAtaIx(cranker.publicKey, feeOwnerWsolAta, feeOwner, NATIVE_MINT));

console.log(`\nSetup ixs: ${setupIxs.length} ATA pre-creates`);
console.log(`Burn ix raw accounts (fixed + remaining): 11 + ${remainingAccounts.length} = ${11 + remainingAccounts.length}`);

// Dedupe to count unique pubkeys (what actually counts for tx size)
const fixedKeys = [
  cranker.publicKey, mint, launchConfig, feeOwner, feeOwnerTokenAta,
  feeOwnerWsolAta, incineratorTokenAta, NATIVE_MINT, JUPITER_V6,
  TOKEN_PROGRAM_ID, SystemProgram.programId, PROGRAM_ID,
];
const all = [...fixedKeys, ...remainingAccounts.map((a) => a.pubkey)];
const unique = new Set(all.map((k) => k.toBase58()));
console.log(`Unique pubkeys after dedup: ${unique.size}`);
console.log(`Estimated tx body bytes (sig + header + ${unique.size} × 32 + blockhash + ix): ~${64 + 3 + unique.size * 32 + 32 + 200}`);

if (!execute) {
  console.log("\n(dry-run; --execute to send)");
  process.exit(0);
}

async function sendLegacy(ixs, label) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = cranker.publicKey;
  tx.sign(cranker);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK [${label}]  ${sig}`);
  return sig;
}

async function sendV0(ixs, lookupTables, label) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
  const msg = new TransactionMessage({
    payerKey: cranker.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(msg);
  tx.sign([cranker]);
  const raw = tx.serialize();
  console.log(`  [${label}] tx size: ${raw.length} bytes`);
  // Resend in a loop until we see a result; helps with congested mainnet
  const sig = await conn.sendRawTransaction(raw, {
    skipPreflight: true,
    maxRetries: 0,
  });
  console.log(`  [${label}] sent: ${sig}`);
  for (let i = 0; i < 60; i++) {
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
    if (st.value?.confirmationStatus === "confirmed" || st.value?.confirmationStatus === "finalized") {
      if (st.value.err) {
        throw new Error(`tx ${sig} on-chain error: ${JSON.stringify(st.value.err)}`);
      }
      console.log(`OK [${label}]  ${sig}`);
      return sig;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`tx ${sig} not confirmed in 60s`);
}

try {
  // 1. ATA pre-creates (legacy tx, small)
  if (setupIxs.length) {
    await sendLegacy(
      [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...setupIxs],
      "ata-setup"
    );
  }

  // 2. Build/reuse an ALT. Set ALT_ADDRESS env var to reuse one across runs.
  const altAddresses = Array.from(unique)
    .map((s) => new PublicKey(s))
    .filter((pk) => !pk.equals(cranker.publicKey)); // signer must stay static

  let altAddress;
  if (process.env.ALT_ADDRESS) {
    altAddress = new PublicKey(process.env.ALT_ADDRESS);
    const existing = await conn.getAddressLookupTable(altAddress);
    if (!existing.value) throw new Error("ALT_ADDRESS not found on chain");
    const onChain = new Set(existing.value.state.addresses.map((p) => p.toBase58()));
    const missing = altAddresses.filter((p) => !onChain.has(p.toBase58()));
    console.log(`\nReusing ALT ${altAddress.toBase58()} (has ${onChain.size}, missing ${missing.length})`);
    for (let i = 0; i < missing.length; i += 20) {
      const chunk = missing.slice(i, i + 20);
      const ext = AddressLookupTableProgram.extendLookupTable({
        payer: cranker.publicKey,
        authority: cranker.publicKey,
        lookupTable: altAddress,
        addresses: chunk,
      });
      await sendLegacy([ext], `alt-extend-${i}`);
    }
  } else {
    console.log(`\nCreating new ALT with ${altAddresses.length} addresses…`);
    const slot = await conn.getSlot("finalized");
    const [createAltIx, addr] = AddressLookupTableProgram.createLookupTable({
      authority: cranker.publicKey,
      payer: cranker.publicKey,
      recentSlot: slot,
    });
    altAddress = addr;
    await sendLegacy([createAltIx], "alt-create");
    console.log(`  ALT address: ${altAddress.toBase58()}  (export ALT_ADDRESS=${altAddress.toBase58()} to reuse)`);

    for (let i = 0; i < altAddresses.length; i += 20) {
      const chunk = altAddresses.slice(i, i + 20);
      const ext = AddressLookupTableProgram.extendLookupTable({
        payer: cranker.publicKey,
        authority: cranker.publicKey,
        lookupTable: altAddress,
        addresses: chunk,
      });
      await sendLegacy([ext], `alt-extend-${i}`);
    }
  }

  // Wait until all our desired addresses are in the ALT AND current slot
  // has advanced past lastExtendedSlot (so the new entries are usable).
  const desiredSet = new Set(altAddresses.map((p) => p.toBase58()));
  let altAccount;
  for (let i = 0; i < 60; i++) {
    const fetched = await conn.getAddressLookupTable(altAddress);
    if (fetched.value) {
      const onChain = new Set(fetched.value.state.addresses.map((p) => p.toBase58()));
      const allPresent = [...desiredSet].every((s) => onChain.has(s));
      if (allPresent) {
        const cur = await conn.getSlot("confirmed");
        const lastExt = Number(fetched.value.state.lastExtendedSlot);
        if (cur > lastExt) {
          altAccount = fetched.value;
          console.log(`  ALT ready: ${onChain.size} addresses, lastExt=${lastExt}, cur=${cur}`);
          break;
        } else {
          console.log(`  waiting for slot advance... lastExt=${lastExt}, cur=${cur}`);
        }
      } else {
        const missing = [...desiredSet].filter((s) => !onChain.has(s)).length;
        console.log(`  waiting for ${missing} addresses to propagate (have ${onChain.size})...`);
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!altAccount) throw new Error("ALT not activated in time");

  // 3. Send burn tx as v0 with the ALT + priority fee
  await sendV0(
    [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      burnIx,
    ],
    [altAccount],
    "burn"
  );
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
