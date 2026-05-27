/**
 * POST /api/launch/create
 *
 * Accepts multipart/form-data with: name, symbol, description, image (File),
 * and optional twitter / telegram / website URLs.
 *
 * Uploads the image + metadata JSON to Pinata IPFS so pump.fun's indexer can
 * fetch them. Generates an ephemeral session keypair. Returns the deposit
 * address + session id.
 */

import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/sessions";
import { pinFile, pinJson } from "@/lib/server/pinata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Required SOL to fund a launch:
//   0.022  pump.fun create rent (mint + bonding_curve + metadata + ATAs)
//   0.020  register_launch protocol fee
//   0.001  tx + signature fees
//   0.007  safety buffer for ATA + metadata size variance
//   -----
//   0.050  total
const REQUIRED_LAMPORTS = 50_000_000;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const name = (form.get("name") as string | null)?.trim();
    const symbol = (form.get("symbol") as string | null)?.trim();
    const description = (form.get("description") as string | null)?.trim() ?? "";
    const image = form.get("image") as File | null;
    const twitter = normalizeUrl(form.get("twitter") as string | null);
    const telegram = normalizeUrl(form.get("telegram") as string | null);
    const website = normalizeUrl(form.get("website") as string | null);

    if (!name || !symbol) {
      return NextResponse.json({ error: "name and symbol required" }, { status: 400 });
    }
    if (symbol.length < 2 || symbol.length > 10) {
      return NextResponse.json({ error: "symbol must be 2–10 chars" }, { status: 400 });
    }
    if (!image || image.size === 0) {
      return NextResponse.json({ error: "image required" }, { status: 400 });
    }
    if (image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "image must be ≤ 5MB" }, { status: 400 });
    }

    // Pin image to IPFS first so we can embed its gateway URL in the JSON.
    const imagePin = await pinFile(image, `${symbol}-${Date.now()}-${image.name}`);

    // Metaplex / pump.fun metadata shape. Only include socials that were
    // provided — empty strings would still render as broken links.
    const metadata: Record<string, unknown> = {
      name,
      symbol,
      description,
      image: imagePin.url,
      showName: true,
      createdOn: "liquiditybank",
    };
    if (twitter) metadata.twitter = twitter;
    if (telegram) metadata.telegram = telegram;
    if (website) metadata.website = website;

    const metadataPin = await pinJson(metadata, `${symbol}-${Date.now()}-metadata.json`);

    const session = createSession({
      name,
      symbol,
      description,
      imageUrl: imagePin.url,
      metadataUrl: metadataPin.url,
      twitter,
      telegram,
      website,
    });

    return NextResponse.json({
      sessionId: session.id,
      depositAddress: session.keypair.publicKey.toBase58(),
      requiredLamports: REQUIRED_LAMPORTS,
      requiredSol: REQUIRED_LAMPORTS / 1e9,
      imageUrl: imagePin.url,
      metadataUrl: metadataPin.url,
    });
  } catch (e: any) {
    console.error("[launch/create] error:", e);
    return NextResponse.json(
      { error: e?.message ?? "failed to create launch session" },
      { status: 500 }
    );
  }
}

function normalizeUrl(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Allow bare handles or domains — prepend https:// if no scheme.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
