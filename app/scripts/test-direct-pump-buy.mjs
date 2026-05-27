#!/usr/bin/env node
/**
 * Diagnostic: call pump.fun's buy_exact_quote_in_v2 DIRECTLY from the admin
 * wallet (bypassing our program), to determine whether the BuyZeroAmount we
 * see when fee_owner is the buyer is caused by:
 *   (a) something specific to our program's CPI (would be FIXED by this test)
 *   (b) pump.fun blocking the creator from buying their own coin (test FAILS
 *       the same way as our program — different reason)
 *   (c) something curve-specific or ABI-related (test fails differently)
 *
 * Spends 0.01 SOL. Tokens (if any) are bought to the admin wallet's ATA;
 * we don't transfer them to incinerator, they just sit.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const PUMP_SHARING_PROGRAM_ID = new PublicKey(
  Uint8Array.from([
    12, 53, 255, 169, 5, 90, 142, 86, 141, 168, 247, 188, 7, 86, 21, 39, 76,
    241, 201, 44, 164, 31, 64, 0, 156, 81, 106, 164, 20, 194, 124, 112,
  ])
);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const BUY_DISC = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);

const mintArg = process.argv[2];
if (!mintArg) {
  console.error("usage: node scripts/test-direct-pump-buy.mjs <mint> [--execute]");
  process.exit(1);
}
const execute = process.argv.includes("--execute");
const mint = new PublicKey(mintArg);

const user = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/id.json"), "utf8"))
  )
);

function ata(owner, m, tp = TOKEN_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tp.toBuffer(), m.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

const [pumpGlobal] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM_ID);
const [bondingCurve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID);
const [eventAuth] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM_ID);
const [globalVolAcc] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMP_PROGRAM_ID);
const [userVolAcc] = PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), user.publicKey.toBuffer()], PUMP_PROGRAM_ID);
const [feeConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_config"), PUMP_PROGRAM_ID.toBuffer()],
  PUMP_FEES_PROGRAM_ID
);
const [sharingConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("sharing-config"), mint.toBuffer()],
  PUMP_SHARING_PROGRAM_ID
);

// Fetch global to pick fee_recipient + buyback_fee_recipient
const conn = new Connection(RPC, "confirmed");
const globalInfo = await conn.getAccountInfo(pumpGlobal);
const gd = globalInfo.data;
const feeRecipients = [];
for (let i = 0; i < 7; i++) feeRecipients.push(new PublicKey(gd.subarray(162 + i * 32, 162 + (i + 1) * 32)));
const buybackRecipients = [];
for (let i = 0; i < 8; i++) buybackRecipients.push(new PublicKey(gd.subarray(741 + i * 32, 741 + (i + 1) * 32)));
const ZERO = "11111111111111111111111111111111";

// Check if creator_vault for the curve's actual creator exists
const bcInfo = await conn.getAccountInfo(bondingCurve);
const curveCreator = new PublicKey(bcInfo.data.subarray(8 + 8 * 5 + 1, 8 + 8 * 5 + 1 + 32));
const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), curveCreator.toBuffer()], PUMP_PROGRAM_ID);

// Need to init user_volume_accumulator first if not exists
const uvaInfo = await conn.getAccountInfo(userVolAcc);

const userTokAta = ata(user.publicKey, mint);
const userWsolAta = ata(user.publicKey, NATIVE_MINT);
const assocBaseBc = ata(bondingCurve, mint);
const assocQuoteBc = ata(bondingCurve, NATIVE_MINT);
const assocCv = ata(creatorVault, NATIVE_MINT);
const assocUva = ata(userVolAcc, NATIVE_MINT);
// Try fee_recipients[4] (matches the reference tx that succeeded)
const fr = feeRecipients[4];
const bbf = buybackRecipients[0];
const assocQfr = ata(fr, NATIVE_MINT);
const assocQbbf = ata(bbf, NATIVE_MINT);

console.log(`User (admin):        ${user.publicKey.toBase58()}`);
console.log(`Curve creator:       ${curveCreator.toBase58()}`);
console.log(`Buyer == creator?    ${user.publicKey.equals(curveCreator) ? "YES" : "NO"}`);
console.log(`fee_recipient:       ${fr.toBase58()}  (index ${feeRecipients.findIndex((p) => p.equals(fr))})`);
console.log(`buyback recipient:   ${bbf.toBase58()}`);
console.log(`user_vol_accumulator exists: ${uvaInfo ? "yes" : "no"}`);

const SPEND = 100_000_000n; // 0.1 SOL

if (!execute) {
  console.log(`(dry-run) Would spend ${SPEND} lamports (0.01 SOL).`);
  process.exit(0);
}

// Setup: init user_vol_accumulator if missing, then createIdempotent all ATAs, then wrap WSOL
const setupIxs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })];

if (!uvaInfo) {
  setupIxs.push(
    new TransactionInstruction({
      programId: PUMP_PROGRAM_ID,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: user.publicKey, isSigner: false, isWritable: false }, // user param
        { pubkey: userVolAcc, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: eventAuth, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([94, 6, 202, 115, 255, 96, 232, 183]),
    })
  );
}

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
    data: Buffer.from([1]),
  });
}

const checks = await Promise.all([
  conn.getAccountInfo(userTokAta),
  conn.getAccountInfo(userWsolAta),
  conn.getAccountInfo(assocQuoteBc),
  conn.getAccountInfo(assocCv),
  conn.getAccountInfo(assocUva),
  conn.getAccountInfo(assocQfr),
  conn.getAccountInfo(assocQbbf),
]);
const [eTok, eWsol, eAssocQuoteBc, eAssocCv, eAssocUva, eAssocQfr, eAssocQbbf] = checks;
if (!eTok) setupIxs.push(createAtaIx(user.publicKey, userTokAta, user.publicKey, mint));
if (!eWsol) setupIxs.push(createAtaIx(user.publicKey, userWsolAta, user.publicKey, NATIVE_MINT));
if (!eAssocQuoteBc) setupIxs.push(createAtaIx(user.publicKey, assocQuoteBc, bondingCurve, NATIVE_MINT));
if (!eAssocCv) setupIxs.push(createAtaIx(user.publicKey, assocCv, creatorVault, NATIVE_MINT));
if (!eAssocUva) setupIxs.push(createAtaIx(user.publicKey, assocUva, userVolAcc, NATIVE_MINT));
if (!eAssocQfr) setupIxs.push(createAtaIx(user.publicKey, assocQfr, fr, NATIVE_MINT));
if (!eAssocQbbf) setupIxs.push(createAtaIx(user.publicKey, assocQbbf, bbf, NATIVE_MINT));

// Wrap SOL → WSOL: transfer to userWsolAta then sync_native
setupIxs.push(
  SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: userWsolAta,
    lamports: SPEND,
  })
);
setupIxs.push(
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: userWsolAta, isSigner: false, isWritable: true }],
    data: Buffer.from([17]), // sync_native
  })
);

const buyData = Buffer.concat([
  BUY_DISC,
  Buffer.from(new BigUint64Array([SPEND]).buffer),
  Buffer.alloc(8), // min_tokens_out = 0
]);

const buyIx = new TransactionInstruction({
  programId: PUMP_PROGRAM_ID,
  keys: [
    { pubkey: pumpGlobal, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: fr, isSigner: false, isWritable: true },
    { pubkey: assocQfr, isSigner: false, isWritable: true },
    { pubkey: bbf, isSigner: false, isWritable: true },
    { pubkey: assocQbbf, isSigner: false, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: assocBaseBc, isSigner: false, isWritable: true },
    { pubkey: assocQuoteBc, isSigner: false, isWritable: true },
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    { pubkey: userTokAta, isSigner: false, isWritable: true },
    { pubkey: userWsolAta, isSigner: false, isWritable: true },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: assocCv, isSigner: false, isWritable: true },
    { pubkey: sharingConfig, isSigner: false, isWritable: false },
    { pubkey: globalVolAcc, isSigner: false, isWritable: true },
    { pubkey: userVolAcc, isSigner: false, isWritable: true },
    { pubkey: assocUva, isSigner: false, isWritable: true },
    { pubkey: feeConfig, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEES_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuth, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: buyData,
});

async function send(ixs, label) {
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = user.publicKey;
  tx.sign(user);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`OK [${label}] tx=${sig}`);
  return sig;
}

try {
  // Split: setup (likely small) + buy
  if (setupIxs.length > 1) {
    // setupIxs likely too large; split further
    const ataCreates = setupIxs.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    const init = setupIxs.filter((ix) => ix.programId.equals(PUMP_PROGRAM_ID));
    const wrapIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...setupIxs.filter(
        (ix) =>
          ix.programId.equals(SystemProgram.programId) ||
          ix.programId.equals(TOKEN_PROGRAM_ID)
      ),
    ];
    if (init.length || ataCreates.length) {
      await send(
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...init, ...ataCreates],
        "setup"
      );
    }
    if (wrapIxs.length > 1) await send(wrapIxs, "wrap");
  }
  await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), buyIx], "buy");
} catch (e) {
  console.error("FAIL:", e?.message ?? e);
  if (e?.logs) for (const l of e.logs) console.error("  ", l);
  process.exit(1);
}
