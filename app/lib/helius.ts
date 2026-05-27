/**
 * Helius helpers — server-only.
 *
 * Never import this file from a client component. Helius API key reads from
 * process.env, which is only available on the server.
 *
 * What lives here:
 *   - fetchLaunchConfigs()        : reads every LaunchConfig PDA on chain
 *   - fetchBondingCurveState(mint): pump.fun bonding curve account → reserves
 *   - fetchTokenMetadata(mint)    : name / symbol / uri via Helius DAS
 *   - fetchSolPriceUsd()          : SOL price for USD conversion (Pyth via Helius)
 *   - getLaunchData(mint)         : composite — everything we know about one launch
 *   - listLaunches()              : same composite for all launches
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "./liquiditybank.idl.json";

const RPC = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC;
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W"
);
const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);

// ----------------------------------------------------------------------------
// Connection / Anchor program (server-only)
// ----------------------------------------------------------------------------
function getConnection(): Connection {
  if (!RPC) throw new Error("HELIUS_RPC_URL not configured");
  return new Connection(RPC, "confirmed");
}

function getProgram(): Program {
  const connection = getConnection();
  // Read-only — manual wallet shim that satisfies AnchorProvider's interface
  // without requiring us to import the `Wallet` class (which is awkward in
  // ESM-Next.js boundary). We never sign anything from the server.
  const readOnlyWallet = {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("server-side helius client is read-only");
    },
    signAllTransactions: async () => {
      throw new Error("server-side helius client is read-only");
    },
  };
  const provider = new AnchorProvider(connection, readOnlyWallet as any, {
    commitment: "confirmed",
  });
  return new Program(idl as any, provider);
}

// ----------------------------------------------------------------------------
// LaunchConfig — our program's per-launch state
// ----------------------------------------------------------------------------
export type LaunchConfigState = {
  mint: string;
  registrant: string;
  createdAt: number;
  cumulativeFeesCollected: bigint;
  cumulativeLpSolAdded: bigint;
  cumulativeLpBurned: bigint;
  cumulativeCurveSolSpent: bigint;
  cumulativeTokensBurned: bigint;
  crankCount: number;
  curveBurnCount: number;
};

export async function fetchLaunchConfigs(): Promise<LaunchConfigState[]> {
  const program = getProgram();
  try {
    // @ts-expect-error account namespace is generated at runtime from IDL
    const accs = await program.account.launchConfig.all();
    return accs.map((a: any) => ({
      mint: a.account.mint.toBase58(),
      registrant: a.account.registrant.toBase58(),
      createdAt: Number(a.account.createdAt),
      cumulativeFeesCollected: BigInt(a.account.cumulativeFeesCollected.toString()),
      cumulativeLpSolAdded: BigInt(a.account.cumulativeLpSolAdded.toString()),
      cumulativeLpBurned: BigInt(a.account.cumulativeLpBurned.toString()),
      cumulativeCurveSolSpent: BigInt(
        a.account.cumulativeCurveSolSpent?.toString() ?? "0"
      ),
      cumulativeTokensBurned: BigInt(
        a.account.cumulativeTokensBurned?.toString() ?? "0"
      ),
      crankCount: Number(a.account.crankCount),
      curveBurnCount: Number(a.account.curveBurnCount ?? 0),
    }));
  } catch (e) {
    // Program likely not yet deployed on this cluster — empty list is fine.
    return [];
  }
}

// ----------------------------------------------------------------------------
// Pump.fun bonding curve state
// ----------------------------------------------------------------------------
// Layout (verified from pump.fun IDL):
//   8  bytes  discriminator
//   8  bytes  virtual_token_reserves : u64
//   8  bytes  virtual_sol_reserves   : u64
//   8  bytes  real_token_reserves    : u64
//   8  bytes  real_sol_reserves      : u64
//   8  bytes  token_total_supply     : u64
//   1  byte   complete               : bool
//   32 bytes  creator                : pubkey

export type BondingCurveState = {
  exists: boolean;
  graduated: boolean;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  creator: string;
  /**
   * Live spot price = virtual_sol / virtual_token, in lamports per smallest token unit.
   * To get SOL per UI token (1e6 decimals): price * 1e6 / 1e9 = price / 1000
   */
  priceLamportsPerRaw: number;
  /**
   * Market cap in SOL = price × total_supply (in UI units).
   * Pump.fun mints 1B tokens (1_000_000_000) with 6 decimals.
   */
  marketCapSol: number;
};

export async function fetchBondingCurveState(
  mint: PublicKey
): Promise<BondingCurveState | null> {
  const connection = getConnection();
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info || info.data.length < 81) {
    return {
      exists: false,
      graduated: false,
      virtualSolReserves: 0n,
      virtualTokenReserves: 0n,
      realSolReserves: 0n,
      realTokenReserves: 0n,
      tokenTotalSupply: 0n,
      creator: "",
      priceLamportsPerRaw: 0,
      marketCapSol: 0,
    };
  }
  const d = info.data;
  const virtualTokenReserves = d.readBigUInt64LE(8);
  const virtualSolReserves = d.readBigUInt64LE(16);
  const realTokenReserves = d.readBigUInt64LE(24);
  const realSolReserves = d.readBigUInt64LE(32);
  const tokenTotalSupply = d.readBigUInt64LE(40);
  const graduated = d.readUInt8(48) === 1;
  const creator = new PublicKey(d.subarray(49, 49 + 32)).toBase58();

  // price (lamports / raw token unit). To convert: lamports/raw → SOL/UI = / 1e3
  const priceLamportsPerRaw =
    virtualTokenReserves > 0n
      ? Number(virtualSolReserves) / Number(virtualTokenReserves)
      : 0;
  // market cap in SOL: (lamports / raw) * total_supply_raw / 1e9 lamports-per-SOL
  const marketCapSol =
    (priceLamportsPerRaw * Number(tokenTotalSupply)) / 1e9;

  return {
    exists: true,
    graduated,
    virtualSolReserves,
    virtualTokenReserves,
    realSolReserves,
    realTokenReserves,
    tokenTotalSupply,
    creator,
    priceLamportsPerRaw,
    marketCapSol,
  };
}

// ----------------------------------------------------------------------------
// Token metadata via Helius Digital Asset Standard (DAS)
// ----------------------------------------------------------------------------
export type TokenMetadata = {
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string | null;
};

export async function fetchTokenMetadata(
  mint: string
): Promise<TokenMetadata | null> {
  if (!RPC) return null;
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "liquiditybank-meta",
        method: "getAsset",
        params: { id: mint },
      }),
    });
    const json = await res.json();
    const a = json?.result;
    if (!a) return null;
    const content = a.content ?? {};
    const meta = content.metadata ?? {};
    const links = content.links ?? {};
    return {
      name: meta.name ?? "",
      symbol: meta.symbol ?? "",
      imageUrl: links.image ?? null,
      description: meta.description ?? null,
    };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// SOL/USD price — fetched from Pyth via Helius price API.
// Falls back to a hardcoded value if anything goes wrong.
// ----------------------------------------------------------------------------
let cachedSolUsd: { price: number; at: number } | null = null;

export async function fetchSolPriceUsd(): Promise<number> {
  const FALLBACK = 150;
  if (cachedSolUsd && Date.now() - cachedSolUsd.at < 60_000) {
    return cachedSolUsd.price;
  }
  try {
    // Pyth's Hermes public endpoint — no auth, fast.
    const PYTH_SOL_USD = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SOL_USD}`,
      { next: { revalidate: 60 } }
    );
    const json = await res.json();
    const p = json?.parsed?.[0]?.price;
    if (p) {
      const price = Number(p.price) * Math.pow(10, p.expo);
      cachedSolUsd = { price, at: Date.now() };
      return price;
    }
  } catch {}
  return FALLBACK;
}

// ----------------------------------------------------------------------------
// Composite — everything we know about one launch
// ----------------------------------------------------------------------------
export type LaunchData = {
  mint: string;
  registrant: string;
  createdAt: number;
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string | null;
  /** True if pump.fun's bonding curve account is marked complete. */
  graduated: boolean;
  marketCapSol: number;
  marketCapUsd: number;
  /** All values are lamports (SOL units) or raw token units. */
  cumulativeFeesCollected: string;
  cumulativeLpSolAdded: string;
  cumulativeLpBurned: string;
  cumulativeCurveSolSpent: string;
  cumulativeTokensBurned: string;
  crankCount: number;
  curveBurnCount: number;
};

export async function getLaunchData(mintStr: string): Promise<LaunchData | null> {
  const mint = new PublicKey(mintStr);
  // Fetch program LaunchConfig + bonding-curve + metadata + SOL price in parallel.
  const program = getProgram();
  const [launchConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch-config"), mint.toBuffer()],
    PROGRAM_ID
  );

  const [lcAccount, bc, meta, solUsd] = await Promise.all([
    // @ts-expect-error generated
    program.account.launchConfig.fetch(launchConfig).catch(() => null),
    fetchBondingCurveState(mint),
    fetchTokenMetadata(mintStr),
    fetchSolPriceUsd(),
  ]);

  if (!lcAccount) return null;
  const mcSol = bc?.marketCapSol ?? 0;
  return {
    mint: mintStr,
    registrant: lcAccount.registrant.toBase58(),
    createdAt: Number(lcAccount.createdAt),
    name: meta?.name ?? "",
    symbol: meta?.symbol ?? "",
    imageUrl: meta?.imageUrl ?? null,
    description: meta?.description ?? null,
    graduated: bc?.graduated ?? false,
    marketCapSol: mcSol,
    marketCapUsd: mcSol * solUsd,
    cumulativeFeesCollected: lcAccount.cumulativeFeesCollected.toString(),
    cumulativeLpSolAdded: lcAccount.cumulativeLpSolAdded.toString(),
    cumulativeLpBurned: lcAccount.cumulativeLpBurned.toString(),
    cumulativeCurveSolSpent:
      lcAccount.cumulativeCurveSolSpent?.toString() ?? "0",
    cumulativeTokensBurned:
      lcAccount.cumulativeTokensBurned?.toString() ?? "0",
    crankCount: Number(lcAccount.crankCount),
    curveBurnCount: Number(lcAccount.curveBurnCount ?? 0),
  };
}

export async function listLaunches(): Promise<LaunchData[]> {
  const cfgs = await fetchLaunchConfigs();
  const solUsd = await fetchSolPriceUsd();

  // Fetch curve + metadata for each in parallel.
  const enriched = await Promise.all(
    cfgs.map(async (c) => {
      const mint = new PublicKey(c.mint);
      const [bc, meta] = await Promise.all([
        fetchBondingCurveState(mint),
        fetchTokenMetadata(c.mint),
      ]);
      const mcSol = bc?.marketCapSol ?? 0;
      return {
        mint: c.mint,
        registrant: c.registrant,
        createdAt: c.createdAt,
        name: meta?.name ?? "",
        symbol: meta?.symbol ?? "",
        imageUrl: meta?.imageUrl ?? null,
        description: meta?.description ?? null,
        graduated: bc?.graduated ?? false,
        marketCapSol: mcSol,
        marketCapUsd: mcSol * solUsd,
        cumulativeFeesCollected: c.cumulativeFeesCollected.toString(),
        cumulativeLpSolAdded: c.cumulativeLpSolAdded.toString(),
        cumulativeLpBurned: c.cumulativeLpBurned.toString(),
        cumulativeCurveSolSpent: c.cumulativeCurveSolSpent.toString(),
        cumulativeTokensBurned: c.cumulativeTokensBurned.toString(),
        crankCount: c.crankCount,
        curveBurnCount: c.curveBurnCount,
      } as LaunchData;
    })
  );
  return enriched;
}
