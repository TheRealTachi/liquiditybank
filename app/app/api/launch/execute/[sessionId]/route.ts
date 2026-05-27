/**
 * POST /api/launch/execute/[sessionId]
 *
 * Once the deposit address has enough SOL, this builds + signs + sends the
 * launch transaction using the session's ephemeral keypair.
 *
 * On success: stores the resulting mint + tx signature in the session and
 * returns them to the client.
 */

import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/server/sessions";
import { executeLaunch, getDepositBalance } from "@/lib/server/launch-tx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const REQUIRED_LAMPORTS = 50_000_000;

export async function POST(
  _req: Request,
  ctx: { params: { sessionId: string } }
) {
  const session = getSession(ctx.params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Idempotent: if already launched, just return the result
  if (session.mint && session.txSignature) {
    return NextResponse.json({
      mint: session.mint,
      txSignature: session.txSignature,
      alreadyLaunched: true,
    });
  }

  // Verify the deposit is sufficient
  let balance = 0;
  try {
    balance = await getDepositBalance(session.keypair.publicKey);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Couldn't read deposit balance: ${e?.message}` },
      { status: 500 }
    );
  }
  if (balance < REQUIRED_LAMPORTS) {
    return NextResponse.json(
      {
        error: `Insufficient deposit. Have ${balance} lamports, need ${REQUIRED_LAMPORTS}.`,
        balance,
      },
      { status: 400 }
    );
  }

  try {
    const result = await executeLaunch({
      sessionKeypair: session.keypair,
      name: session.name,
      symbol: session.symbol,
      metadataUri: session.metadataUrl,
    });
    updateSession(session.id, {
      mint: result.mint,
      txSignature: result.txSignature,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    const msg = e?.message ?? "launch tx failed";
    console.error("[launch/execute] error:", e);
    // Log the SPL/Anchor logs if present
    if (e?.logs) {
      for (const l of e.logs) console.error("   ", l);
    }
    updateSession(session.id, { error: msg });
    return NextResponse.json({ error: msg, logs: e?.logs ?? null }, {
      status: 500,
    });
  }
}
