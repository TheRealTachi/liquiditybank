/**
 * Server-side launch transaction builder.
 *
 * Constructs the pump.fun `create` + liquiditybank `register_launch` transaction
 * and signs it with the ephemeral session keypair. The user never touches a
 * wallet — they only fund the session's deposit address.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../liquiditybank.idl.json";

const RPC = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC;
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W"
);
const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const PUMP_CREATE_IX = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

function getConnection(): Connection {
  if (!RPC) throw new Error("HELIUS_RPC_URL not configured");
  return new Connection(RPC, "confirmed");
}

function feeOwnerPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee-owner"), mint.toBuffer()],
    PROGRAM_ID
  );
}
function launchConfigPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("launch-config"), mint.toBuffer()],
    PROGRAM_ID
  );
}
function protocolConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );
}
function protocolRevenuePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-revenue")],
    PROGRAM_ID
  );
}
function pumpBondingCurvePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function pumpMintAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM_ID
  );
}
function pumpGlobal(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM_ID
  );
}
function pumpEventAuthority(): [PublicKey, number] {
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
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function encStr(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

function buildPumpCreateIx(args: {
  user: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}): TransactionInstruction {
  const [bondingCurve] = pumpBondingCurvePda(args.mint);
  const [mintAuthority] = pumpMintAuthority();
  const [global] = pumpGlobal();
  const [eventAuthority] = pumpEventAuthority();
  const [metadata] = metadataPda(args.mint);
  const associatedBondingCurve = ata(bondingCurve, args.mint);

  const data = Buffer.concat([
    PUMP_CREATE_IX,
    encStr(args.name),
    encStr(args.symbol),
    encStr(args.uri),
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

export type LaunchResult = {
  mint: string;
  txSignature: string;
};

/**
 * Build, sign, and send the full launch transaction.
 *
 * The session keypair pays for + signs everything. After this returns,
 * the session keypair has nothing left to do — pump.fun's creator role
 * for the new token is liquiditybank's fee_owner PDA, not this keypair.
 */
export async function executeLaunch(args: {
  sessionKeypair: Keypair;
  name: string;
  symbol: string;
  metadataUri: string;
}): Promise<LaunchResult> {
  const connection = getConnection();

  // Manual wallet shim — same trick as in helius.ts to avoid the
  // ESM Wallet-import issue.
  const wallet = {
    publicKey: args.sessionKeypair.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  const program = new Program(idl as any, provider);

  // Generate the new mint keypair
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const [feeOwner] = feeOwnerPda(mint);
  const [launchConfig] = launchConfigPda(mint);
  const [protocolConfig] = protocolConfigPda();
  const [protocolRevenue] = protocolRevenuePda();

  // 1. pump.fun create
  const createIx = buildPumpCreateIx({
    user: args.sessionKeypair.publicKey,
    mint,
    creator: feeOwner,
    name: args.name,
    symbol: args.symbol,
    uri: args.metadataUri,
  });

  // 2. liquiditybank register_launch
  const registerIx = await program.methods
    .registerLaunch()
    .accounts({
      registrant: args.sessionKeypair.publicKey,
      mint,
      feeOwner,
      launchConfig,
      protocolConfig,
      protocolRevenue,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction();
  tx.add(createIx, registerIx);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = args.sessionKeypair.publicKey;
  tx.sign(args.sessionKeypair, mintKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, "confirmed");

  return { mint: mint.toBase58(), txSignature: sig };
}

export async function getDepositBalance(pubkey: PublicKey): Promise<number> {
  const connection = getConnection();
  return await connection.getBalance(pubkey);
}
