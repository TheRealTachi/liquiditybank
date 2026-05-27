/**
 * Pinata IPFS helpers for launch metadata.
 *
 * Pump.fun's indexer fetches the metadata URI passed to its `create` ix and
 * reads `image`, `twitter`, `telegram`, `website` from the JSON. The URI must
 * be publicly reachable, which rules out our own `/public/uploads` directory
 * (Vercel serverless FS is read-only, localhost is unreachable from outside).
 *
 * Uses the official `pinata` SDK, which targets the v3 Files API. New Pinata
 * keys default to v3 scopes; the legacy `/pinning/pinFileToIPFS` endpoint
 * returns `NO_SCOPES_FOUND` for them.
 *
 * Requires PINATA_JWT in the environment. PINATA_GATEWAY is optional and
 * defaults to gateway.pinata.cloud.
 */

import { PinataSDK } from "pinata";

let cached: { sdk: PinataSDK; gateway: string } | undefined;

function client() {
  if (cached) return cached;
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error(
      "PINATA_JWT is not set. Add it to .env.local — get one at https://app.pinata.cloud/developers/api-keys"
    );
  }
  const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
  cached = {
    sdk: new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway }),
    gateway,
  };
  return cached;
}

function gatewayUrl(gateway: string, cid: string): string {
  return `https://${gateway}/ipfs/${cid}`;
}

export async function pinFile(
  file: File,
  _name: string
): Promise<{ cid: string; url: string }> {
  const { sdk, gateway } = client();
  const res = await sdk.upload.public.file(file);
  return { cid: res.cid, url: gatewayUrl(gateway, res.cid) };
}

export async function pinJson(
  payload: unknown,
  _name: string
): Promise<{ cid: string; url: string }> {
  const { sdk, gateway } = client();
  const res = await sdk.upload.public.json(payload as Record<string, unknown>);
  return { cid: res.cid, url: gatewayUrl(gateway, res.cid) };
}
