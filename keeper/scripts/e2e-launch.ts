/**
 * End-to-end launch verification against the cloned-mainnet local validator.
 *
 *   1. Generate a fresh user keypair
 *   2. Airdrop them SOL
 *   3. Build the launch tx (pump.fun create + register_launch)
 *   4. Sign + submit + confirm
 *   5. Read the LaunchConfig PDA — verify counters / dev / mint
 *   6. Read the pump.fun bonding_curve account — verify creator == fee_owner
 *   7. Read protocol_revenue — verify the 0.05 SOL fee landed
 *
 * If all assertions pass, the pump.fun create CPI + liquiditybank register_launch
 * are working correctly together on the live pump.fun program.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

import idl from "../../target/idl/liquiditybank.json" with { type: "json" };
import {
  LIQUIDITYBANK_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  feeOwnerPda,
  launchConfigPda,
  protocolConfigPda,
  protocolRevenuePda,
  associatedTokenAddress,
} from "../lib/programs.js";

const PUMP_CREATE_IX_DISCRIMINATOR = Buffer.from([
  24, 30, 200, 40, 5, 28, 7, 119,
]);
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());

// ---------- helpers ----------
function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function pumpBondingCurvePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function pumpMintAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM_ID
  );
}
function pumpGlobalPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM_ID
  );
}
function pumpEventAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );
}
function metadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );
}

// ---------- ix builders ----------
function buildPumpCreateIx(args: {
  user: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}): TransactionInstruction {
  const [bondingCurve] = pumpBondingCurvePda(args.mint);
  const [mintAuthority] = pumpMintAuthorityPda();
  const [global] = pumpGlobalPda();
  const [eventAuthority] = pumpEventAuthorityPda();
  const [metadata] = metadataPda(args.mint);
  const associatedBondingCurve = associatedTokenAddress(
    bondingCurve,
    args.mint
  );

  const data = Buffer.concat([
    PUMP_CREATE_IX_DISCRIMINATOR,
    encodeString(args.name),
    encodeString(args.symbol),
    encodeString(args.uri),
    args.creator.toBuffer(),
  ]);

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: args.mint, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------- main ----------
const adminSecret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(admin);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const program = new Program(idl as any, provider);

console.log("e2e launch test");
console.log("  rpc:    ", RPC);
console.log("  payer:  ", admin.publicKey.toBase58());
console.log("  program:", LIQUIDITYBANK_PROGRAM_ID.toBase58());
console.log();

// 1. Fund a fresh launcher keypair so we know the registrant is a clean wallet.
// We transfer from the admin instead of airdrop because solana-test-validator
// sometimes flakes on requestAirdrop.
const launcher = Keypair.generate();
console.log("[1] funding launcher", launcher.publicKey.toBase58());
const fundTx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: admin.publicKey,
    toPubkey: launcher.publicKey,
    lamports: 5 * LAMPORTS_PER_SOL,
  })
);
const fundBlockhash = await connection.getLatestBlockhash();
fundTx.recentBlockhash = fundBlockhash.blockhash;
fundTx.feePayer = admin.publicKey;
fundTx.sign(admin);
const fundSig = await connection.sendRawTransaction(fundTx.serialize());
await connection.confirmTransaction(fundSig, "confirmed");

// 2. Generate the new pump.fun token mint keypair.
const mintKeypair = Keypair.generate();
const mint = mintKeypair.publicKey;
const [feeOwner] = feeOwnerPda(mint);
const [launchConfig] = launchConfigPda(mint);
const [protocolConfig] = protocolConfigPda();
const [protocolRevenue] = protocolRevenuePda();
console.log("[2] mint =", mint.toBase58());
console.log("    fee_owner =", feeOwner.toBase58());
console.log("    launch_config =", launchConfig.toBase58());

const revenueBefore =
  (await connection.getAccountInfo(protocolRevenue))?.lamports ?? 0;

// 3. Build pump.fun create ix (fee_owner as creator)
const createIx = buildPumpCreateIx({
  user: launcher.publicKey,
  mint,
  creator: feeOwner,
  name: "Test Coin",
  symbol: "TEST",
  uri: "data:application/json;base64," +
    Buffer.from(
      JSON.stringify({
        name: "Test Coin",
        symbol: "TEST",
        description: "e2e localnet test",
      })
    ).toString("base64"),
});

// 4. Build liquiditybank register_launch ix
const registerIx = await program.methods
  .registerLaunch()
  .accounts({
    registrant: launcher.publicKey,
    mint,
    feeOwner,
    launchConfig,
    protocolConfig,
    protocolRevenue,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

// 5. Send both in one tx, signed by launcher + mint
const tx = new Transaction();
tx.add(createIx, registerIx);
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = launcher.publicKey;
tx.sign(launcher, mintKeypair);

console.log("\n[3] submitting launch tx…");
let sig: string;
try {
  sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log("    confirmed:", sig);
} catch (e: any) {
  console.error("    LAUNCH FAILED:", e?.message ?? e);
  if (e?.logs) {
    console.error("    logs:");
    for (const l of e.logs) console.error("     ", l);
  }
  process.exit(1);
}

// 6. Verify on-chain state
console.log("\n[4] verifying on-chain state…");

const lcAccount = await connection.getAccountInfo(launchConfig);
if (!lcAccount) {
  console.error("    FAIL — LaunchConfig not created");
  process.exit(1);
}
console.log("    ✓ LaunchConfig exists (size=" + lcAccount.data.length + ")");

const lc = await (program.account as any).launchConfig.fetch(launchConfig);
console.log("    ✓ LaunchConfig.mint =", lc.mint.toBase58());
console.log("    ✓ LaunchConfig.registrant =", lc.registrant.toBase58());
console.log("    ✓ LaunchConfig.crankCount =", lc.crankCount.toString());

if (lc.mint.toBase58() !== mint.toBase58()) {
  console.error("    FAIL — mint mismatch");
  process.exit(1);
}
if (lc.registrant.toBase58() !== launcher.publicKey.toBase58()) {
  console.error("    FAIL — registrant mismatch");
  process.exit(1);
}

// Verify the pump.fun bonding curve was created with fee_owner as creator
const [bondingCurve] = pumpBondingCurvePda(mint);
const bcAccount = await connection.getAccountInfo(bondingCurve);
if (!bcAccount) {
  console.error("    FAIL — pump.fun bonding_curve not created");
  process.exit(1);
}
console.log(
  "    ✓ pump.fun bonding_curve exists (size=" + bcAccount.data.length + ")"
);

// The bonding curve account's creator field lives at byte offset 8 + (5*8) + 1 = 49
// per pump.fun's PUMP_BONDING_CURVE_CREATOR_OFFSET
const creatorBytes = bcAccount.data.subarray(49, 49 + 32);
const onChainCreator = new PublicKey(creatorBytes);
console.log("    bonding_curve.creator =", onChainCreator.toBase58());
console.log("    expected fee_owner    =", feeOwner.toBase58());
if (onChainCreator.toBase58() !== feeOwner.toBase58()) {
  console.error("    FAIL — bonding_curve creator is NOT fee_owner");
  process.exit(1);
}
console.log("    ✓ pump.fun creator IS the fee_owner PDA");

// Verify the 0.05 SOL launch fee landed in protocol_revenue
const revenueAfter =
  (await connection.getAccountInfo(protocolRevenue))?.lamports ?? 0;
const delta = revenueAfter - revenueBefore;
console.log(
  `    ✓ protocol_revenue grew by ${(delta / LAMPORTS_PER_SOL).toFixed(4)} SOL`
);
if (delta !== 50_000_000) {
  console.error("    FAIL — expected exactly 0.05 SOL (50_000_000 lamports)");
  process.exit(1);
}

console.log("\n[5] all checks pass — pump.fun + liquiditybank integration verified");
console.log("    mint:           ", mint.toBase58());
console.log("    fee_owner PDA:  ", feeOwner.toBase58());
console.log("    launch_config:  ", launchConfig.toBase58());
console.log("    tx:             ", sig);
