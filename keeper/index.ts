/**
 * liquiditybank keeper bot.
 *
 * Polls every launch's fee_owner WSOL ATA. When the balance crosses
 * CRANK_THRESHOLD, it constructs and submits the grow_lp instruction.
 *
 * For each launch it tries collect_curve_fees and collect_amm_fees first
 * (depending on whether the token has graduated) so any pending creator
 * fees land in the fee_owner before grow_lp runs.
 *
 * Usage:
 *   RPC_URL=... KEYPAIR=~/.config/solana/id.json PROGRAM_ID=... \
 *     pnpm start
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

import idl from "../target/idl/liquiditybank.json" with { type: "json" };
import {
  LIQUIDITYBANK_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  feeOwnerPda,
  launchConfigPda,
  pumpCreatorVaultPda,
  pumpEventAuthorityPda,
  pumpAmmEventAuthorityPda,
} from "./lib/programs.js";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());
const POLL_MS = Number(process.env.POLL_MS ?? 15_000);
const CRANK_THRESHOLD = BigInt(
  process.env.CRANK_THRESHOLD ?? 500_000_000 // 0.5 SOL
);

const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
const keeper = Keypair.fromSecretKey(Uint8Array.from(secret));

const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(keeper);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const program = new Program(idl as any, provider);

console.log("liquiditybank keeper");
console.log("  rpc:     ", RPC);
console.log("  keeper:  ", keeper.publicKey.toBase58());
console.log("  program: ", LIQUIDITYBANK_PROGRAM_ID.toBase58());
console.log("  poll:    ", POLL_MS, "ms");
console.log("  threshold:", CRANK_THRESHOLD.toString(), "lamports");
console.log();

async function tick() {
  let launches: any[];
  try {
    // @ts-expect-error generated at runtime from IDL
    launches = await program.account.launchConfig.all();
  } catch (e: any) {
    console.error("[tick] failed to fetch launches:", e?.message ?? e);
    return;
  }

  for (const l of launches) {
    const mint: PublicKey = l.account.mint;
    const [feeOwner] = feeOwnerPda(mint);
    const wsolAta = await getAssociatedTokenAddress(
      NATIVE_MINT,
      feeOwner,
      true
    );

    let wsolBalance = 0n;
    try {
      const ataInfo = await connection.getTokenAccountBalance(wsolAta);
      wsolBalance = BigInt(ataInfo.value.amount);
    } catch {
      // ATA doesn't exist yet, nothing to crank.
      continue;
    }

    if (wsolBalance < CRANK_THRESHOLD) {
      continue;
    }

    console.log(
      `[crank] mint=${mint.toBase58().slice(0, 8)}… wsol=${(
        Number(wsolBalance) / 1e9
      ).toFixed(4)} SOL — firing grow_lp`
    );

    try {
      await fireGrowLp(mint, wsolBalance);
    } catch (e: any) {
      console.error("  failed:", e?.message ?? e);
    }
  }
}

async function fireGrowLp(mint: PublicKey, _wsolBalance: bigint) {
  // The grow_lp instruction requires a long list of PumpSwap pool accounts
  // (pool, pool_v2, lp_mint, base/quote token accounts, protocol/buyback fee
  // recipients, etc). Those come from reading the live PumpSwap pool state
  // off chain.
  //
  // For the v0 keeper we throw a clear error rather than send a malformed tx.
  // Wiring this up requires:
  //   1. Find the canonical pool PDA for `mint`.
  //   2. Read pool state to extract pool_base_token_account, pool_quote_token_account,
  //      lp_mint, coin_creator_vault_authority, etc.
  //   3. Read PumpSwap global_config to pick a protocol_fee_recipient and
  //      buyback_fee_recipient from its arrays.
  //   4. Derive global_volume_accumulator and user_volume_accumulator PDAs.
  //   5. Build the grow_lp tx with all 30+ remaining accounts.
  //
  // This is the same shape of work as an integrated buyback-and-burn crank
  // client. Best path is to lift their TS construction logic.

  throw new Error(
    `grow_lp tx assembly not yet wired in keeper. ` +
      `Mint ${mint.toBase58()} has ≥ threshold WSOL — manual crank for now. ` +
      `See README.md "Wiring grow_lp in the keeper" section.`
  );
}

console.log("[start] entering poll loop\n");
await tick();
setInterval(() => {
  tick().catch((e) => console.error("[tick] uncaught:", e));
}, POLL_MS);
