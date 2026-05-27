import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchData } from "@/lib/helius";

export const revalidate = 15;
export const dynamic = "force-dynamic";

export default async function TokenDetail({
  params,
}: {
  params: { mint: string };
}) {
  const launch = await getLaunchData(params.mint);
  if (!launch) return notFound();

  const feesLamports = BigInt(launch.cumulativeFeesCollected);
  const lpSolLamports = BigInt(launch.cumulativeLpSolAdded);
  const lpBurned = BigInt(launch.cumulativeLpBurned);
  const curveSolLamports = BigInt(launch.cumulativeCurveSolSpent);
  const tokensBurned = BigInt(launch.cumulativeTokensBurned);

  return (
    <div className="max-w-page mx-auto px-6 lg:px-12 py-16 lg:py-20">
      <Link
        href="/launches"
        className="font-mono text-xs tracking-widest text-sky hover:text-brass transition-colors"
      >
        ← TOKENS
      </Link>

      {/* Title row */}
      <div className="mt-8 grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-8 flex items-center gap-6">
          {launch.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={launch.imageUrl}
              alt=""
              className="w-20 h-20 md:w-28 md:h-28 rounded-full object-cover border-2 rule-brass"
            />
          ) : (
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-full bg-marine border-2 rule-brass" />
          )}
          <div>
            <h1 className="font-slab font-medium text-4xl md:text-5xl text-cream tracking-tight leading-none">
              {launch.name || "Unnamed token"}
            </h1>
            <p className="font-mono text-sm text-sky mt-2">
              {launch.symbol && (
                <span className="text-brass mr-3">{launch.symbol}</span>
              )}
              {shorten(launch.mint, 10)}
            </p>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 lg:items-end justify-end">
          <a
            href={`https://pump.fun/${launch.mint}`}
            target="_blank"
            rel="noreferrer"
            className="btn-outline px-5 py-2.5 text-sm"
          >
            Trade on pump.fun ↗
          </a>
          <a
            href={`https://solscan.io/account/${launch.mint}`}
            target="_blank"
            rel="noreferrer"
            className="btn-outline px-5 py-2.5 text-sm"
          >
            View on Solscan ↗
          </a>
        </div>
      </div>

      {launch.description && (
        <p className="mt-8 max-w-prose text-mist leading-[1.65]">
          {launch.description}
        </p>
      )}

      {/* Live stats grid */}
      <div className="mt-12 border-y-2 rule-brass grid grid-cols-2 md:grid-cols-4">
        <Stat
          label="Market cap"
          value={formatUsd(launch.marketCapUsd)}
          sub={`${launch.marketCapSol.toFixed(2)} SOL`}
          accent
        />
        <Stat
          label="State"
          value={launch.graduated ? "Graduated" : "On curve"}
          sub={
            launch.graduated
              ? "trading on PumpSwap"
              : "still on pump.fun bonding curve"
          }
        />
        <Stat
          label="Fees captured"
          value={formatSol(feesLamports)}
          sub={`${
            launch.crankCount + launch.curveBurnCount
          } burn cycles fired`}
        />
        <Stat
          label="Age"
          value={formatRelative(launch.createdAt)}
          sub={new Date(launch.createdAt * 1000).toLocaleDateString()}
        />
      </div>

      {/* Detailed breakdown */}
      <section className="mt-16 grid grid-cols-1 lg:grid-cols-2 border-y-2 rule-brass">
        <div className="bg-vault p-8 border-r rule">
          <p className="eyebrow mb-2">Pre-graduation burn cycle</p>
          <h2 className="font-slab font-medium text-2xl text-cream mb-6">
            Supply burned from the curve
          </h2>
          <Row label="SOL deployed" value={formatSol(curveSolLamports)} />
          <Row
            label="Tokens burned"
            value={formatRawTokens(tokensBurned, launch.symbol)}
            accent
          />
          <Row label="Cycles fired" value={launch.curveBurnCount.toString()} />
          <p className="mt-6 text-xs text-sky leading-[1.6]">
            Each cycle buys tokens from pump.fun&apos;s bonding curve and
            sends them to the incinerator. The SOL stays in the curve and
            becomes LP at graduation.
          </p>
        </div>

        <div className="bg-vault p-8">
          <p className="eyebrow mb-2">Post-graduation burn cycle</p>
          <h2 className="font-slab font-medium text-2xl text-cream mb-6">
            LP burned into PumpSwap
          </h2>
          <Row label="SOL into LP" value={formatSol(lpSolLamports)} />
          <Row
            label="LP tokens burned"
            value={formatRawTokens(lpBurned, "LP")}
            accent
          />
          <Row label="Cycles fired" value={launch.crankCount.toString()} />
          <p className="mt-6 text-xs text-sky leading-[1.6]">
            Each cycle swaps half the vault to tokens, pairs both halves as
            LP, and burns the minted LP tokens. Pool depth grows
            monotonically.
          </p>
        </div>
      </section>

      {/* Crank panel */}
      <section className="mt-16">
        <p className="eyebrow mb-4">Burn cycle</p>
        <h2 className="font-slab font-medium text-3xl text-cream tracking-tight">
          Fire the next burn.
        </h2>
        <p className="mt-3 text-mist max-w-prose leading-[1.65]">
          Once the vault holds ≥ 0.5 SOL, anyone can submit the transaction
          that triggers the burn cycle and earn 0.001 SOL. Live status:
        </p>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 border-y rule mb-6">
          <Stat
            label="In vault"
            value={formatSol(feesLamports)}
            sub="awaiting next cycle"
          />
          <Stat label="Threshold" value="0.5 SOL" sub="any wallet can fire" />
          <Stat label="Reward" value="0.001 SOL" sub="to caller" />
        </div>
        <button
          className="btn-vault disabled:opacity-40"
          disabled={feesLamports < 500_000_000n}
        >
          Fire burn cycle
        </button>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------
function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-vault px-6 py-6 border-r last:border-r-0 rule">
      <p className="eyebrow-soft text-[0.6rem]">{label}</p>
      <p
        className={
          "mt-2 numeral text-2xl md:text-3xl " +
          (accent ? "text-brass" : "text-cream")
        }
      >
        {value}
      </p>
      <p className="text-xs text-sky mt-2">{sub}</p>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="grid grid-cols-12 items-baseline py-3 border-b rule last:border-b-0">
      <span className="col-span-7 text-sm text-mist">{label}</span>
      <span
        className={
          "col-span-5 text-right font-mono " +
          (accent ? "text-brass" : "text-cream")
        }
      >
        {value}
      </span>
    </div>
  );
}

// Formatters
function formatSol(lamports: bigint): string {
  const n = Number(lamports) / 1e9;
  if (n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k SOL`;
  if (n >= 1) return `${n.toFixed(3)} SOL`;
  return `${n.toFixed(4)} SOL`;
}
function formatUsd(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
function formatRawTokens(raw: bigint, symbol: string): string {
  const n = Number(raw) / 1e6;
  if (n === 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ${symbol}`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M ${symbol}`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k ${symbol}`;
  return `${n.toFixed(2)} ${symbol}`;
}
function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
function shorten(s: string, n = 6): string {
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}
