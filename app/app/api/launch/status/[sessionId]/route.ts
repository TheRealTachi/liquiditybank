/**
 * GET /api/launch/status/[sessionId]
 *
 * Returns the current state of a launch session — its deposit balance,
 * whether it's funded, and (if launched) the resulting mint + tx sig.
 *
 * The frontend polls this every 3-5 seconds while waiting for the user
 * to deposit.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/sessions";
import { getDepositBalance } from "@/lib/server/launch-tx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 0.05 SOL — kept in sync with /create
const REQUIRED_LAMPORTS = 50_000_000;

export async function GET(
  _req: Request,
  ctx: { params: { sessionId: string } }
) {
  const session = getSession(ctx.params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found or expired" }, { status: 404 });
  }

  let balance = 0;
  try {
    balance = await getDepositBalance(session.keypair.publicKey);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "RPC error reading balance" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId: session.id,
    depositAddress: session.keypair.publicKey.toBase58(),
    balance,
    requiredLamports: REQUIRED_LAMPORTS,
    funded: balance >= REQUIRED_LAMPORTS,
    name: session.name,
    symbol: session.symbol,
    imageUrl: session.imageUrl,
    mint: session.mint ?? null,
    txSignature: session.txSignature ?? null,
    error: session.error ?? null,
  });
}
