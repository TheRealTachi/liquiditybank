import type { Metadata } from "next";
import Link from "next/link";
import { WalletShell, ConnectButton } from "@/components/wallet-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Liquidity Bank — a pump.fun vault that only takes in",
  description:
    "Deposit a token. Every trade routes its creator fees one way — into the vault, then into permanent supply reduction or permanent locked liquidity. Nothing comes out.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <WalletShell>
          <header className="border-b rule-brass relative z-10 bg-vault/85 backdrop-blur">
            <nav className="max-w-page mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-3 group whitespace-nowrap"
              >
                {/* Wax-seal-ish brass mark */}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 22 22"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="group-hover:rotate-45 transition-transform duration-700"
                  aria-hidden
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="9.5"
                    fill="none"
                    stroke="#c8a661"
                    strokeWidth="1"
                  />
                  <circle
                    cx="11"
                    cy="11"
                    r="6"
                    fill="none"
                    stroke="#c8a661"
                    strokeOpacity="0.5"
                    strokeWidth="1"
                  />
                  <circle cx="11" cy="11" r="1.6" fill="#c8a661" />
                  {[0, 90, 180, 270].map((a, i) => {
                    const r = (a * Math.PI) / 180;
                    const x = 11 + Math.cos(r) * 6;
                    const y = 11 + Math.sin(r) * 6;
                    return (
                      <circle key={i} cx={x} cy={y} r="0.8" fill="#c8a661" />
                    );
                  })}
                </svg>
                <span className="font-slab font-semibold tracking-wider text-cream uppercase text-sm">
                  Liquidity · Bank
                </span>
              </Link>
              <div className="flex items-center gap-7 text-sm text-mist">
                <Link
                  href="/launch"
                  className="hover:text-brass transition-colors"
                >
                  Deploy
                </Link>
                <Link
                  href="/launches"
                  className="hover:text-brass transition-colors"
                >
                  Tokens
                </Link>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-brass transition-colors"
                >
                  Source
                </a>
                <ConnectButton />
              </div>
            </nav>
          </header>

          <main className="flex-1 relative">{children}</main>

          <footer className="border-t rule-brass mt-24 relative">
            <div className="max-w-page mx-auto px-6 lg:px-12 py-10 flex flex-col md:flex-row justify-between gap-6 text-xs">
              <div className="font-mono text-sky">
                Liquidity Bank · Est. 2026
              </div>
              <div className="font-mono text-sky">
                Program ·{" "}
                <span className="text-brass">
                  LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W
                </span>
              </div>
            </div>
          </footer>
        </WalletShell>
      </body>
    </html>
  );
}
