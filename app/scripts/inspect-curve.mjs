#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const mint = new PublicKey(process.argv[2]);
const [bondingCurve] = PublicKey.findProgramAddressSync(
  [Buffer.from("bonding-curve"), mint.toBuffer()],
  PUMP_PROGRAM_ID
);
const conn = new Connection(RPC, "confirmed");
const info = await conn.getAccountInfo(bondingCurve);
if (!info) throw new Error("not found");
const d = info.data;
console.log(`size: ${d.length}`);
let o = 8;
const virtualTokR = d.readBigUInt64LE(o); o += 8;
const virtualQuoteR = d.readBigUInt64LE(o); o += 8;
const realTokR = d.readBigUInt64LE(o); o += 8;
const realQuoteR = d.readBigUInt64LE(o); o += 8;
const totalSupply = d.readBigUInt64LE(o); o += 8;
const complete = d[o]; o += 1;
const creator = new PublicKey(d.subarray(o, o + 32)); o += 32;
const isMayhemMode = d[o]; o += 1;
const isCashbackCoin = d[o]; o += 1;
const quoteMint = new PublicKey(d.subarray(o, o + 32)); o += 32;

console.log("virtual_token_reserves:", virtualTokR);
console.log("virtual_quote_reserves:", virtualQuoteR);
console.log("real_token_reserves:   ", realTokR);
console.log("real_quote_reserves:   ", realQuoteR);
console.log("token_total_supply:    ", totalSupply);
console.log("complete:              ", complete);
console.log("creator:               ", creator.toBase58());
console.log("is_mayhem_mode:        ", isMayhemMode);
console.log("is_cashback_coin:      ", isCashbackCoin);
console.log("quote_mint:            ", quoteMint.toBase58());
console.log("(SOL =                  So11111111111111111111111111111111111111112)");
