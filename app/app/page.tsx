"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { VaultDoor } from "@/components/vault-door";
import { FlowDiagram } from "@/components/flow-diagram";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.2, 0.6, 0.2, 1] },
  },
};

export default function Landing() {
  return (
    <>
      {/* HERO — brand-first nameplate */}
      <section className="relative">
        <div className="max-w-page mx-auto px-6 lg:px-12 relative">
          {/* Tech badges row */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="pt-10 pb-6 flex flex-wrap items-center gap-2"
          >
            <Chip>Permissionless</Chip>
            <Chip>Anchor 0.31</Chip>
            <Chip>Solana mainnet</Chip>
            <Chip>Open source</Chip>
          </motion.div>

          {/* Brand wordmark + hero copy together */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="pt-8 pb-12 grid grid-cols-12 gap-x-8 lg:gap-x-12 items-start"
          >
            <div className="col-span-12 lg:col-span-7">
              <h1 className="font-slab font-semibold text-cream leading-[1.0] tracking-tight text-[2.5rem] md:text-[3.5rem] lg:text-[4.5rem]">
                Liquidity Bank<span className="text-brass">.</span>
              </h1>

              <p className="mt-6 text-mist text-lg md:text-xl leading-[1.55] max-w-xl">
                A pump.fun launchpad where each launched token&apos;s creator
                role belongs to an on-chain Solana program, not a wallet. The
                program receives the token&apos;s creator fees and routes
                them, atomically, into supply burns (pre-graduation) or LP
                burns (post-graduation).{" "}
                <span className="text-brass italic">
                  The vault has no withdraw instruction. No human ever holds
                  the fees.
                </span>
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link href="/launch" className="btn-vault">
                  Open an account →
                </Link>
                <Link href="/launches" className="btn-outline">
                  See live launches
                </Link>
              </div>

              <a
                href="https://solscan.io/account/LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W"
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-baseline gap-2 text-xs font-mono text-sky hover:text-brass transition-colors"
              >
                <span className="text-brass/70">↗</span>
                Program · LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W
              </a>
            </div>

            <aside className="col-span-12 lg:col-span-5 lg:pl-6 mt-10 lg:mt-2 text-sm text-mist leading-[1.65] border-l-2 rule-brass pl-6">
              <p className="eyebrow-soft mb-3">How burns happen</p>
              <p>
                Once a token&apos;s vault has collected{" "}
                <span className="kbd-pill">≥ 0.5 SOL</span> in creator fees, a
                burn cycle becomes runnable. It&apos;s not on a timer — the
                program is passive — but the instruction is permissionless,
                so any wallet can submit the transaction and earn a small
                reward.
              </p>
              <p className="mt-3">
                In practice that means either a Solana MEV searcher, our own
                keeper bot, or a visitor clicking the &ldquo;Fire burn
                cycle&rdquo; button on the launch&apos;s page. The economics
                guarantee one of those three pushes the button.
              </p>
            </aside>
          </motion.div>

          <div className="double-rule" />

          {/* Specimen band — now BELOW the hero as its own section, full width */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={fadeUp}
            className="pt-12 pb-16"
          >
            <div className="grid grid-cols-12 gap-x-6 lg:gap-x-8 mb-6">
              <span className="col-span-12 lg:col-span-3 eyebrow">
                Specimen · No. 01
              </span>
              <p className="col-span-12 lg:col-span-9 text-sky text-xs font-mono leading-[1.6] tracking-wide">
                Every figure below is read directly from the program&apos;s
                on-chain configuration. Enforced by code, not by promise.
              </p>
            </div>
            <div className="border-y-2 rule-brass grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              <SpecCell label="Setup fee" value="0.05 SOL" sub="one-time" />
              <SpecCell
                label="Creator fee"
                value="0.30 – 0.95%"
                sub="by MC tier"
              />
              <SpecCell
                label="Burn threshold"
                value="0.5 SOL"
                sub="any wallet can fire"
              />
              <SpecCell
                label="Instructions"
                value="6"
                sub="none give value"
              />
              <SpecCell
                label="Withdraw paths"
                value="0"
                sub="none in code"
                accent
              />
              <SpecCell label="Network" value="mainnet" sub="beta" mono />
            </div>
          </motion.div>
        </div>
      </section>

      {/* II — HOW IT WORKS (numbered, plain) */}
      <section className="border-t rule-brass">
        <div className="max-w-page mx-auto px-6 lg:px-12 py-20">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="max-w-3xl mb-12"
          >
            <p className="eyebrow mb-4">How it works</p>
            <h2 className="font-slab font-medium text-3xl md:text-4xl text-cream leading-tight">
              Four steps. None of them need you.
            </h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border-t border-b rule"
          >
            <StepBlock
              n="01"
              title="Open"
              body="Launch a pump.fun token through the bank's launchpad. The contract pays 0.05 SOL and sets its own program-derived address as the creator. From that point on, fees stream to the program, not a human."
            />
            <StepBlock
              n="02"
              title="Accrue"
              body="Every trade — buy or sell, on the bonding curve or on PumpSwap — pays a 0.30% creator fee. The fees collect in the contract's vault. Nobody has the key to that vault."
            />
            <StepBlock
              n="03"
              title="Crank"
              body="When the vault holds ≥ 0.5 SOL, the burn cycle becomes runnable. Anyone — MEV searchers, our keeper, or a visitor with the button — submits the transaction and earns a small reward. The program picks supply-burn or LP-burn based on whether the token has graduated."
            />
            <StepBlock
              n="04"
              title="Burn"
              body="Pre-graduation: vault buys from the curve, tokens go to the incinerator. Post-graduation: vault swaps half, pairs as LP, LP goes to the incinerator. Both are atomic. Both are forever."
              accent
            />
          </motion.div>
        </div>
      </section>

      {/* III — FLOW DIAGRAM */}
      <section className="border-t rule">
        <div className="max-w-page mx-auto px-6 lg:px-12 py-20">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
          >
            <p className="eyebrow mb-4">The path of a SOL</p>
            <h2 className="font-slab font-medium text-3xl md:text-4xl text-cream leading-tight max-w-2xl">
              Where each fee actually goes.
            </h2>
            <div className="mt-12">
              <FlowDiagram />
            </div>
          </motion.div>
        </div>
      </section>

      {/* IV — TRUST (bullet-pointed, not prose) */}
      <section className="border-t rule-brass">
        <div className="max-w-page mx-auto px-6 lg:px-12 py-20 grid grid-cols-12 gap-x-8 lg:gap-x-12">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="col-span-12 lg:col-span-5"
          >
            <p className="eyebrow mb-4">Trust property</p>
            <h2 className="font-slab font-medium text-3xl md:text-4xl text-cream leading-tight">
              No human can take anything back out.
            </h2>
            <p className="mt-6 text-mist leading-[1.65] max-w-prose">
              Every instruction the program exposes is on this page. None
              moves value to a wallet. The program ID and source are public,
              the IDL is on chain, and the build is verified.
            </p>
          </motion.div>

          <motion.ul
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="col-span-12 lg:col-span-7 space-y-0 border-t border-b rule"
          >
            <TrustRow
              ix="initialize_protocol"
              role="One-time admin setup. Creates the singleton config + revenue accounts."
            />
            <TrustRow
              ix="register_launch"
              role="Anyone calls this. Pays the 0.05 SOL setup fee. Wires a pump.fun mint into the program."
            />
            <TrustRow
              ix="collect_curve_fees"
              role="Permissionless. Pulls creator fees out of pump.fun's bonding curve into the vault."
            />
            <TrustRow
              ix="collect_amm_fees"
              role="Permissionless. Pulls creator fees out of PumpSwap into the vault (post-graduation)."
            />
            <TrustRow
              ix="burn_from_curve"
              role="Permissionless. Pre-graduation cycle: vault spends SOL on the curve, sends tokens to the incinerator."
            />
            <TrustRow
              ix="grow_lp"
              role="Permissionless. Post-graduation cycle: swap half, pair LP, burn LP to the incinerator."
            />
            <li className="px-6 py-5 flex items-baseline gap-4">
              <span className="font-mono text-xs text-sky line-through">
                withdraw
              </span>
              <span className="text-sm text-brass">does not exist</span>
            </li>
            <li className="px-6 py-5 flex items-baseline gap-4">
              <span className="font-mono text-xs text-sky line-through">
                migrate
              </span>
              <span className="text-sm text-brass">does not exist</span>
            </li>
            <li className="px-6 py-5 flex items-baseline gap-4">
              <span className="font-mono text-xs text-sky line-through">
                admin_set_anything
              </span>
              <span className="text-sm text-brass">does not exist</span>
            </li>
          </motion.ul>
        </div>
      </section>

      {/* V — BOOKKEEPING */}
      <section className="border-t rule-brass">
        <div className="max-w-page mx-auto px-6 lg:px-12 py-20">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="max-w-3xl mb-12"
          >
            <p className="eyebrow mb-4">Numbers</p>
            <h2 className="font-slab font-medium text-3xl md:text-4xl text-cream leading-tight">
              Pump.fun&apos;s creator fee is dynamic. So is what we capture.
            </h2>
            <p className="mt-4 text-mist max-w-prose leading-[1.65]">
              Pump.fun&apos;s on-chain fee config has 25 tiers, indexed by the
              pool&apos;s market cap. The creator&apos;s share starts at 0.30% on
              the bonding curve, peaks at <span className="text-brass">0.95%</span> in
              the early post-graduation range, and declines toward 0.05% as
              the pool grows past ~$15M MC.
            </p>
          </motion.div>

          {/* Fee tier breakdown */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="engraved mb-10"
          >
            <div className="grid grid-cols-12 px-6 py-3 text-xs font-mono uppercase tracking-widest text-sky border-b rule">
              <span className="col-span-5">Pool state</span>
              <span className="col-span-3 text-right">MC range</span>
              <span className="col-span-4 text-right">Creator fee</span>
            </div>
            <Tier
              state="Bonding curve"
              range="any (pre-grad)"
              fee="0.30%"
            />
            <Tier
              state="PumpSwap, tier 0"
              range="< ~$63k"
              fee="0.30%"
            />
            <Tier
              state="PumpSwap, tier 1"
              range="$63k – $220k"
              fee="0.95%"
              accent
            />
            <Tier
              state="PumpSwap, tiers 2–10"
              range="$220k – $4.4M"
              fee="0.50% – 0.90%"
            />
            <Tier
              state="PumpSwap, tiers 11–24"
              range="$4.4M – $15M+"
              fee="0.05% – 0.50%"
            />
          </motion.div>

          {/* Captured at scale — using a blended 0.6% effective rate */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
          >
            <p className="text-mist max-w-prose leading-[1.65] mb-6">
              Most coins that graduate live in the 0.50%–0.95% range for most
              of their volume. Using a blended <span className="text-brass">0.6%</span> effective
              rate, the figures look like:
            </p>
            <div className="engraved">
              <div className="grid grid-cols-12 px-6 py-3 text-xs font-mono uppercase tracking-widest text-sky border-b rule">
                <span className="col-span-5">Lifetime trade volume</span>
                <span className="col-span-3 text-right">Fees captured</span>
                <span className="col-span-4 text-right">Held by vault</span>
              </div>
              <Book row="$100,000" cap="$600" />
              <Book row="$1,000,000" cap="$6,000" />
              <Book row="$10,000,000" cap="$60,000" />
              <Book row="$100,000,000" cap="$600,000" accent />
            </div>
            <p className="mt-4 text-sm text-sky leading-relaxed max-w-prose">
              All figures verified against pump.fun&apos;s on-chain fee_config
              (program{" "}
              <span className="text-brass font-mono">pfeeUx…ojVZ</span>) on
              mainnet, May 2026. Rates can be changed by pump.fun governance;
              the bank routes whatever pump.fun pays.
            </p>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t rule-brass relative overflow-hidden">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="max-w-page mx-auto px-6 lg:px-12 py-24 relative"
        >
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Open an account</p>
            <h2 className="font-slab font-medium text-3xl md:text-5xl text-cream leading-[1.1]">
              Launch a pump.fun token whose fees you can&apos;t touch.
            </h2>
            <p className="text-mist mt-6 text-lg leading-[1.7] max-w-prose">
              Three fields, one signature, 0.05 SOL. From the moment the
              transaction confirms, the program owns the creator role. You
              keep no key to the vault and no instruction to take from it.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/launch" className="btn-vault">
                Open an account →
              </Link>
              <Link href="/launches" className="btn-outline">
                See live launches
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function TechBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[0.7rem] font-mono uppercase tracking-widest text-sky">
      <span className="w-1 h-1 rounded-full bg-brass" />
      {children}
    </span>
  );
}

function Chip({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-sm text-[0.65rem] font-mono uppercase tracking-widest " +
        (muted
          ? "border-rule text-sky/70"
          : "border-brass/40 text-brass bg-brass/[0.04]")
      }
    >
      <span
        className={
          "w-1 h-1 rounded-full " + (muted ? "bg-sky/60" : "bg-brass")
        }
      />
      {children}
    </span>
  );
}

function SpecRow({
  label,
  value,
  sub,
  accent,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="px-5 py-4 grid grid-cols-12 items-baseline gap-3 border-b rule last:border-b-0">
      <span className="col-span-5 eyebrow-soft text-[0.6rem]">{label}</span>
      <span className="col-span-7 text-right">
        <span
          className={
            (mono ? "font-mono text-base " : "numeral text-2xl ") +
            (accent ? "text-brass" : "text-cream")
          }
        >
          {value}
        </span>
        {sub && (
          <span className="block text-[0.65rem] text-sky font-mono mt-0.5 tracking-wide">
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="eyebrow-soft text-[0.6rem]">{label}</span>
      <span className="numeral text-2xl text-cream mt-1">{value}</span>
      <span className="text-xs text-sky mt-1">{sub}</span>
    </div>
  );
}

function StepBlock({
  n,
  title,
  body,
  accent,
}: {
  n: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div className="p-8 border-r last:border-r-0 md:border-b-0 border-b rule">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-xs text-brass">{n}</span>
        <h3
          className={
            "font-slab font-medium text-2xl " +
            (accent ? "text-brass" : "text-cream")
          }
        >
          {title}
        </h3>
      </div>
      <p className="text-mist text-sm leading-[1.65]">{body}</p>
    </div>
  );
}

function TrustRow({ ix, role }: { ix: string; role: string }) {
  return (
    <li className="px-6 py-5 grid grid-cols-12 items-baseline gap-4 border-b rule last:border-b-0">
      <span className="col-span-12 md:col-span-4 font-mono text-sm text-brass">
        {ix}
      </span>
      <span className="col-span-12 md:col-span-8 text-sm text-mist leading-[1.55]">
        {role}
      </span>
    </li>
  );
}

function SpecCell({
  label,
  value,
  sub,
  accent,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="px-5 py-5 border-r last:border-r-0 md:border-b-0 border-b rule">
      <p className="eyebrow-soft text-[0.6rem] mb-2">{label}</p>
      <p
        className={
          (mono ? "font-mono text-base " : "numeral text-2xl ") +
          (accent ? "text-brass" : "text-cream")
        }
      >
        {value}
      </p>
      {sub && (
        <p className="text-[0.65rem] text-sky font-mono mt-1 tracking-wide">
          {sub}
        </p>
      )}
    </div>
  );
}

function Tier({
  state,
  range,
  fee,
  accent,
}: {
  state: string;
  range: string;
  fee: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "grid grid-cols-12 px-6 py-4 items-baseline border-b rule last:border-b-0 transition-colors " +
        (accent ? "bg-brass/5" : "")
      }
    >
      <span className="col-span-5 text-cream text-sm">{state}</span>
      <span className="col-span-3 text-right font-mono text-sm text-mist">
        {range}
      </span>
      <span
        className={
          "col-span-4 text-right numeral text-lg " +
          (accent ? "text-brass" : "text-cream")
        }
      >
        {fee}
      </span>
    </div>
  );
}

function Book({
  row,
  cap,
  accent,
}: {
  row: string;
  cap: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "grid grid-cols-12 px-6 py-5 items-baseline border-b rule last:border-b-0 transition-colors " +
        (accent ? "bg-brass/5" : "")
      }
    >
      <span className="col-span-5 numeral text-2xl text-cream">{row}</span>
      <span
        className={
          "col-span-3 text-right font-mono text-sm " +
          (accent ? "text-brass" : "text-mist")
        }
      >
        {cap}
      </span>
      <span className="col-span-4 text-right font-mono text-xs text-sky tracking-wider uppercase">
        Forever
      </span>
    </div>
  );
}
