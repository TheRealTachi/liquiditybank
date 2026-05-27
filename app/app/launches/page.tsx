import Link from "next/link";
import { listLaunches, type LaunchData } from "@/lib/helius";

// Refetch every 30s; show fresh data without per-request hammering Helius.
export const revalidate = 30;
export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const launches = await listLaunches();

  // Aggregate totals
  const totalFees = launches.reduce(
    (a, l) => a + BigInt(l.cumulativeFeesCollected),
    0n
  );
  const totalSolToLp = launches.reduce(
    (a, l) => a + BigInt(l.cumulativeLpSolAdded),
    0n
  );
  const totalBurns = launches.reduce(
    (a, l) => a + l.crankCount + l.curveBurnCount,
    0
  );
  const totalMc = launches.reduce((a, l) => a + l.marketCapUsd, 0);

  return (
    <div className="max-w-page mx-auto px-6 lg:px-12 py-16 lg:py-20">
      <div className="max-w-3xl mb-12">
        <p className="eyebrow mb-4">Live · Liquidity Bank · Tokens</p>
        <h1 className="font-slab font-medium text-4xl md:text-5xl text-cream tracking-tight leading-tight">
          Every token deployed through the bank.
        </h1>
        <p className="mt-4 text-mist leading-[1.65] max-w-prose">
          Read directly from the program&apos;s LaunchConfig accounts plus
          pump.fun bonding-curve state via Helius. Refreshes every 30
          seconds.
        </p>
      </div>

      {/* Aggregate totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 border-y-2 rule-brass mb-12">
        <Agg label="Tokens deployed" value={launches.length.toString()} />
        <Agg label="Total market cap" value={formatUsd(totalMc)} mono />
        <Agg label="Fees captured" value={formatSol(totalFees)} mono />
        <Agg label="Burn cycles" value={totalBurns.toString()} />
      </div>

      {launches.length === 0 ? (
        <EmptyState />
      ) : (
        <LaunchTable launches={launches} />
      )}

      <p className="mt-10 text-xs font-mono text-sky tracking-wide max-w-prose">
        Live data via Helius RPC. Cumulative figures are on-chain LaunchConfig
        counters — monotonically increasing.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-y-2 rule-brass py-20 text-center">
      <p className="eyebrow mb-3">No tokens yet</p>
      <p className="text-mist text-lg max-w-md mx-auto leading-[1.6]">
        Liquidity Bank&apos;s program is deployed but no tokens have been
        launched through it yet. Be the first.
      </p>
      <Link href="/launch" className="btn-vault mt-8 inline-flex">
        Deploy a token →
      </Link>
    </div>
  );
}

function LaunchTable({ launches }: { launches: LaunchData[] }) {
  return (
    <div className="border-y-2 rule-brass">
      <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-xs font-mono uppercase tracking-widest text-sky border-b rule">
        <div className="col-span-3">Token</div>
        <div className="col-span-2 text-right">Market cap</div>
        <div className="col-span-2 text-right">Fees captured</div>
        <div className="col-span-2 text-right">SOL → LP</div>
        <div className="col-span-1 text-right">Burns</div>
        <div className="col-span-2 text-right">State</div>
      </div>
      <ul className="divide-y divide-rule">
        {launches.map((l) => (
          <li key={l.mint}>
            <Link
              href={`/launches/${l.mint}`}
              className="grid grid-cols-12 gap-4 px-6 py-5 items-baseline hover:bg-brass/[0.04] transition-colors"
            >
              <div className="col-span-12 md:col-span-3 flex items-center gap-3">
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.imageUrl}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover border rule"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-marine border rule-brass" />
                )}
                <div>
                  <div className="font-slab font-medium text-cream">
                    {l.name || "Unnamed"}
                  </div>
                  <div className="font-mono text-xs text-sky">
                    {l.symbol || shorten(l.mint, 6)}
                  </div>
                </div>
              </div>
              <div className="col-span-6 md:col-span-2 text-right">
                <span className="numeral text-lg text-cream">
                  {formatUsd(l.marketCapUsd)}
                </span>
              </div>
              <div className="col-span-6 md:col-span-2 text-right">
                <span className="font-mono text-sm text-mist">
                  {formatSol(BigInt(l.cumulativeFeesCollected))}
                </span>
              </div>
              <div className="col-span-6 md:col-span-2 text-right">
                <span className="font-mono text-sm text-brass">
                  {formatSol(BigInt(l.cumulativeLpSolAdded))}
                </span>
              </div>
              <div className="col-span-3 md:col-span-1 text-right">
                <span className="font-mono text-sm text-mist">
                  {l.crankCount + l.curveBurnCount}
                </span>
              </div>
              <div className="col-span-3 md:col-span-2 text-right">
                <StateBadge graduated={l.graduated} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Agg({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-vault px-6 py-6 border-r last:border-r-0 rule">
      <p className="eyebrow-soft text-[0.6rem]">{label}</p>
      <p
        className={
          "mt-2 " +
          (mono ? "font-mono text-xl text-cream" : "numeral text-2xl text-cream")
        }
      >
        {value}
      </p>
    </div>
  );
}

function StateBadge({ graduated }: { graduated: boolean }) {
  if (graduated) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[0.65rem] font-mono uppercase tracking-widest border border-brass/40 text-brass bg-brass/[0.04] rounded-sm">
        <span className="w-1 h-1 rounded-full bg-brass" />
        Graduated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[0.65rem] font-mono uppercase tracking-widest border border-rule text-sky rounded-sm">
      <span className="w-1 h-1 rounded-full bg-sky/70" />
      On curve
    </span>
  );
}

// ----------------------------------------------------------------------------
// Formatters
// ----------------------------------------------------------------------------
function formatSol(lamports: bigint): string {
  const n = Number(lamports) / 1e9;
  if (n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k SOL`;
  if (n >= 1) return `${n.toFixed(2)} SOL`;
  return `${n.toFixed(4)} SOL`;
}

function formatUsd(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function shorten(s: string, n = 6): string {
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}
