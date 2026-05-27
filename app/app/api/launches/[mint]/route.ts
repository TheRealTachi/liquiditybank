/**
 * GET /api/launches/[mint]
 *
 * Returns the same composite as /api/launches but for a single mint.
 * Used by the per-launch detail page to show live market cap + on-chain
 * cumulative figures.
 */

import { NextResponse } from "next/server";
import { getLaunchData } from "@/lib/helius";

export const revalidate = 30;
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: { mint: string } }
) {
  try {
    const data = await getLaunchData(ctx.params.mint);
    if (!data) {
      return NextResponse.json(
        { error: "Launch not found on chain", mint: ctx.params.mint },
        { status: 404 }
      );
    }
    return NextResponse.json({ launch: data, ts: Date.now() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "failed to fetch launch" },
      { status: 500 }
    );
  }
}
