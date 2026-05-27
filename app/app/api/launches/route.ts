/**
 * GET /api/launches
 *
 * Returns a JSON array of every LaunchConfig PDA on chain, enriched with:
 *   - pump.fun bonding-curve state (live market cap)
 *   - token metadata (name, symbol, image)
 *   - SOL/USD price applied for USD market cap
 *
 * Server-only — uses the Helius API key from env.
 */

import { NextResponse } from "next/server";
import { listLaunches } from "@/lib/helius";

// Re-fetch every 30s on Vercel; never cache the API key.
export const revalidate = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const launches = await listLaunches();
    return NextResponse.json({
      launches,
      ts: Date.now(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "failed to fetch launches", launches: [] },
      { status: 500 }
    );
  }
}
