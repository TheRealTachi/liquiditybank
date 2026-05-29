/**
 * liquiditybank keeper bot.
 *
 * Polls every registered launch and runs the appropriate cranks:
 *
 *   Pre-graduation (still on the pump.fun bonding curve):
 *     collect_curve_fees  — pull creator fees into fee_owner (bare SOL)
 *     burn_from_curve     — once fee_owner ≥ threshold, buy+SPL-burn tokens
 *
 *   Post-graduation (migrated to a PumpSwap AMM pool):
 *     collect_amm_fees    — pull WSOL creator fees into fee_owner's WSOL ATA
 *     grow_lp             — NOT YET IMPLEMENTED (needs Jupiter swap + PumpSwap
 *                           deposit router assembly). Logs and skips.
 *
 * Usage:
 *   RPC_URL=... KEEPER_SECRET_KEY=<json|base58> PROGRAM_ID=... pnpm start
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

import idl from "./idl/liquiditybank.json" with { type: "json" };
import {
  LIQUIDITYBANK_PROGRAM_ID,
  NATIVE_MINT,
  feeOwnerPda,
  pumpCreatorVaultPda,
  pumpAmmCreatorVaultAuthorityPda,
} from "./lib/programs.js";
import {
  isGraduated,
  collectCurveFees,
  collectAmmFees,
  burnFromCurve,
  growLp,
} from "./lib/cranks.js";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH = (
  process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
).replace(/^~(?=\/)/, os.homedir());
const POLL_MS = Number(process.env.POLL_MS ?? 15_000);
const CRANK_THRESHOLD = BigInt(
  process.env.CRANK_THRESHOLD ?? 500_000_000 // 0.5 SOL
);
// Skip a collect tx unless at least this much is claimable (avoids no-op fees).
const COLLECT_MIN = BigInt(process.env.COLLECT_MIN_LAMPORTS ?? 5_000_000); // 0.005 SOL
// Safety gate: grow_lp assembly is unverified against a real pool. Off by default.
const ENABLE_GROW_LP = process.env.ENABLE_GROW_LP === "true";

// Prefer an inline secret key (KEEPER_SECRET_KEY) so the bot can run in
// environments without a keypair file on disk (e.g. Railway). Accepts either
// a JSON byte array (same content as a Solana keypair file) or a base58
// secret-key string. Falls back to reading KEYPAIR_PATH off disk for local dev.
function loadKeeperKeypair(): Keypair {
  const inline = process.env.KEEPER_SECRET_KEY?.trim();
  if (inline) {
    if (inline.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
    }
    return Keypair.fromSecretKey(bs58.decode(inline));
  }
  const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const keeper = loadKeeperKeypair();

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

const fmt = (lamports: bigint) => (Number(lamports) / 1e9).toFixed(4);

async function crankLaunch(mint: PublicKey, tag: string) {
  const [feeOwner] = feeOwnerPda(mint);
  const graduated = await isGraduated(program, mint);

  if (!graduated) {
    // --- Pre-graduation: collect_curve_fees → burn_from_curve ---
    const [creatorVault] = pumpCreatorVaultPda(feeOwner);
    const vaultInfo = await connection.getAccountInfo(creatorVault);
    const claimable = vaultInfo ? BigInt(vaultInfo.lamports) : 0n;
    if (claimable >= COLLECT_MIN) {
      console.log(`[${tag}] collect_curve_fees (~${fmt(claimable)} SOL in vault)`);
      const sig = await collectCurveFees(program, keeper, mint);
      console.log(`[${tag}]   ✓ ${sig}`);
    }

    const bareSol = BigInt(await connection.getBalance(feeOwner));
    if (bareSol >= CRANK_THRESHOLD) {
      console.log(`[${tag}] fee_owner=${fmt(bareSol)} SOL ≥ threshold — burn_from_curve`);
      const sig = await burnFromCurve(program, keeper, mint);
      console.log(`[${tag}]   ✓ ${sig}`);
    }
    return;
  }

  // --- Post-graduation: collect_amm_fees → grow_lp (not implemented) ---
  const [coinCreatorVaultAuthority] = pumpAmmCreatorVaultAuthorityPda(feeOwner);
  const coinCreatorVaultAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    coinCreatorVaultAuthority,
    true
  );
  let ammClaimable = 0n;
  try {
    const b = await connection.getTokenAccountBalance(coinCreatorVaultAta);
    ammClaimable = BigInt(b.value.amount);
  } catch {
    // vault ATA doesn't exist yet — nothing to collect.
  }
  if (ammClaimable >= COLLECT_MIN) {
    console.log(`[${tag}] collect_amm_fees (~${fmt(ammClaimable)} SOL in vault)`);
    const sig = await collectAmmFees(program, keeper, mint);
    console.log(`[${tag}]   ✓ ${sig}`);
  }

  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, feeOwner, true);
  let wsol = 0n;
  try {
    const b = await connection.getTokenAccountBalance(wsolAta);
    wsol = BigInt(b.value.amount);
  } catch {
    // WSOL ATA doesn't exist yet.
  }
  if (wsol >= CRANK_THRESHOLD) {
    if (!ENABLE_GROW_LP) {
      console.warn(
        `[${tag}] WSOL=${fmt(wsol)} SOL ≥ threshold — grow_lp ready but DISABLED. ` +
          `Set ENABLE_GROW_LP=true to enable (validate against the real pool first).`
      );
      return;
    }
    console.log(`[${tag}] WSOL=${fmt(wsol)} SOL ≥ threshold — grow_lp`);
    const sig = await growLp(program, keeper, mint);
    console.log(`[${tag}]   ✓ ${sig}`);
  }
}

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
    const tag = mint.toBase58().slice(0, 8) + "…";
    try {
      await crankLaunch(mint, tag);
    } catch (e: any) {
      console.error(`[${tag}] crank error:`, e?.message ?? e);
    }
  }
}

console.log("[start] entering poll loop\n");
await tick();
setInterval(() => {
  tick().catch((e) => console.error("[tick] uncaught:", e));
}, POLL_MS);
