/**
 * Persistent session store for the custodial launch flow.
 *
 * - Sessions live on globalThis so HMR can't wipe them mid-flow.
 * - Each session is also written to disk (.liquiditybank-sessions/<id>.json)
 *   so a full server restart doesn't lose the ephemeral keypair.
 * - Sessions auto-expire after 30 minutes.
 *
 * IMPORTANT: for production, replace this with Redis + KMS-encrypted secret
 * keys. Disk persistence is suitable for local dev and single-instance
 * deployments only.
 */

import { Keypair } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import bs58 from "bs58";

export type LaunchSession = {
  id: string;
  createdAt: number;
  keypair: Keypair;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  metadataUrl: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  mint?: string;
  txSignature?: string;
  error?: string;
};

type DiskRecord = Omit<LaunchSession, "keypair"> & { secretBase58: string };

const SESSIONS_DIR = path.join(process.cwd(), ".liquiditybank-sessions");
try {
  mkdirSync(SESSIONS_DIR, { recursive: true });
} catch {}

const TTL_MS = 30 * 60 * 1000;

const G = globalThis as unknown as {
  __liquiditybankSessions?: Map<string, LaunchSession>;
  __liquiditybankSessionsSweeper?: NodeJS.Timeout;
  __liquiditybankSessionsLoaded?: boolean;
};
const sessions: Map<string, LaunchSession> =
  G.__liquiditybankSessions ?? (G.__liquiditybankSessions = new Map());

// Load any persisted sessions from disk on first import per process
if (!G.__liquiditybankSessionsLoaded) {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = readFileSync(path.join(SESSIONS_DIR, f), "utf8");
        const r: DiskRecord = JSON.parse(raw);
        if (Date.now() - r.createdAt > TTL_MS) {
          unlinkSync(path.join(SESSIONS_DIR, f));
          continue;
        }
        const secret = bs58.decode(r.secretBase58);
        const kp = Keypair.fromSecretKey(secret);
        sessions.set(r.id, {
          id: r.id,
          createdAt: r.createdAt,
          keypair: kp,
          name: r.name,
          symbol: r.symbol,
          description: r.description,
          imageUrl: r.imageUrl,
          metadataUrl: r.metadataUrl,
          twitter: r.twitter,
          telegram: r.telegram,
          website: r.website,
          mint: r.mint,
          txSignature: r.txSignature,
          error: r.error,
        });
      } catch (e) {
        console.error("[sessions] failed to load", f, e);
      }
    }
  } catch (e) {
    console.error("[sessions] failed to read sessions dir", e);
  }
  G.__liquiditybankSessionsLoaded = true;
}

// Install TTL sweeper once
if (!G.__liquiditybankSessionsSweeper) {
  G.__liquiditybankSessionsSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > TTL_MS) {
        sessions.delete(id);
        try {
          unlinkSync(path.join(SESSIONS_DIR, `${id}.json`));
        } catch {}
      }
    }
  }, 60_000);
  G.__liquiditybankSessionsSweeper.unref?.();
}

function persist(s: LaunchSession) {
  const record: DiskRecord = {
    id: s.id,
    createdAt: s.createdAt,
    secretBase58: bs58.encode(s.keypair.secretKey),
    name: s.name,
    symbol: s.symbol,
    description: s.description,
    imageUrl: s.imageUrl,
    metadataUrl: s.metadataUrl,
    twitter: s.twitter,
    telegram: s.telegram,
    website: s.website,
    mint: s.mint,
    txSignature: s.txSignature,
    error: s.error,
  };
  writeFileSync(
    path.join(SESSIONS_DIR, `${s.id}.json`),
    JSON.stringify(record, null, 2),
    { mode: 0o600 }
  );
}

export function createSession(input: Omit<
  LaunchSession,
  "id" | "createdAt" | "keypair" | "mint" | "txSignature" | "error"
>): LaunchSession {
  const id = randomBytes(16).toString("hex");
  const session: LaunchSession = {
    id,
    createdAt: Date.now(),
    keypair: Keypair.generate(),
    ...input,
  };
  sessions.set(id, session);
  persist(session);
  return session;
}

export function getSession(id: string): LaunchSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, patch: Partial<LaunchSession>) {
  const s = sessions.get(id);
  if (!s) return;
  Object.assign(s, patch);
  persist(s);
}

export function deleteSession(id: string) {
  sessions.delete(id);
  try {
    unlinkSync(path.join(SESSIONS_DIR, `${id}.json`));
  } catch {}
}

/**
 * Returns the deposit addresses of all currently-known sessions. Useful for
 * recovery — if a user thinks they lost a deposit, the address might still
 * be findable here.
 */
export function listSessionDepositAddresses(): { id: string; address: string; createdAt: number }[] {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    address: s.keypair.publicKey.toBase58(),
    createdAt: s.createdAt,
  }));
}
