"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

type Step = "form" | "deposit" | "launching" | "done" | "error";

type SessionStatus = {
  sessionId: string;
  depositAddress: string;
  balance: number;
  requiredLamports: number;
  funded: boolean;
  name: string;
  symbol: string;
  imageUrl: string;
  mint: string | null;
  txSignature: string | null;
  error: string | null;
};

export default function LaunchPage() {
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canSubmit =
    name.trim().length >= 2 &&
    symbol.trim().length >= 2 &&
    symbol.trim().length <= 10 &&
    imageFile !== null;

  // Cleanup poller on unmount or step change
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleFileSelect(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be 5 MB or smaller");
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function submitForm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim());
      form.set("description", description.trim());
      form.set("image", imageFile!);
      if (twitter.trim()) form.set("twitter", twitter.trim());
      if (telegram.trim()) form.set("telegram", telegram.trim());
      if (website.trim()) form.set("website", website.trim());

      const res = await fetch("/api/launch/create", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");

      setSession({
        sessionId: data.sessionId,
        depositAddress: data.depositAddress,
        balance: 0,
        requiredLamports: data.requiredLamports,
        funded: false,
        name: name.trim(),
        symbol: symbol.trim(),
        imageUrl: data.imageUrl,
        mint: null,
        txSignature: null,
        error: null,
      });
      setStep("deposit");
      startPolling(data.sessionId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(sessionId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/launch/status/${sessionId}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Status check failed");
          return;
        }
        setSession((prev) => ({ ...prev!, ...data }));
        if (data.funded && step !== "launching" && step !== "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          executeLaunch(sessionId);
        }
      } catch (e: any) {
        setError(e?.message ?? "Polling error");
      }
    }, 3000);
  }

  async function executeLaunch(sessionId: string) {
    setStep("launching");
    try {
      const res = await fetch(`/api/launch/execute/${sessionId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Launch tx failed");
      setSession((prev) =>
        prev ? { ...prev, mint: data.mint, txSignature: data.txSignature } : prev
      );
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStep("error");
      // Keep polling alive so a top-up + retry works
      if (session?.sessionId) startPolling(session.sessionId);
    }
  }

  function retryLaunch() {
    if (!session?.sessionId) return;
    setError(null);
    executeLaunch(session.sessionId);
  }

  function copyAddress() {
    if (!session) return;
    navigator.clipboard.writeText(session.depositAddress);
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep("form");
    setName("");
    setSymbol("");
    setDescription("");
    setTwitter("");
    setTelegram("");
    setWebsite("");
    setImageFile(null);
    setImagePreview(null);
    setSession(null);
    setError(null);
  }

  return (
    <div className="max-w-page mx-auto px-6 lg:px-12 py-16 lg:py-20">
      <Link
        href="/"
        className="font-mono text-xs tracking-widest text-sky hover:text-brass transition-colors"
      >
        ← LIQUIDITY BANK
      </Link>

      <div className="mt-8 max-w-3xl">
        <p className="eyebrow mb-4">Open an account</p>
        <h1 className="font-slab font-semibold text-cream text-4xl md:text-5xl tracking-tight leading-[1.1]">
          {step === "form" && "Deploy a token."}
          {step === "deposit" && "Send 0.05 SOL to launch."}
          {step === "launching" && "Launching…"}
          {step === "done" && "Token deployed."}
          {step === "error" && "Launch failed."}
        </h1>
        <p className="mt-4 text-mist text-lg leading-[1.55] max-w-xl">
          {step === "form" &&
            "No wallet to connect. Fill in the form, send 0.05 SOL to the deposit address we generate, and the bank signs the launch tx for you. That 0.05 covers everything — pump.fun create rent, the protocol fee, and network fees."}
          {step === "deposit" &&
            "Once the deposit lands the bank's ephemeral wallet will sign + submit the launch transaction automatically. The pump.fun creator role for your token will be the bank's vault PDA — no human key."}
          {step === "launching" &&
            "Building and broadcasting the pump.fun create + register_launch transaction. This usually takes 5–15 seconds."}
          {step === "done" &&
            "Pump.fun token live. Its creator role is the bank's vault — fees route there on every trade."}
          {step === "error" &&
            "Something went wrong submitting the transaction. The deposit is still in the session wallet and can be retried."}
        </p>
      </div>

      <div className="mt-16">
        <AnimatePresence mode="wait">
          {step === "form" && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <FormStep
                name={name}
                setName={setName}
                symbol={symbol}
                setSymbol={setSymbol}
                description={description}
                setDescription={setDescription}
                twitter={twitter}
                setTwitter={setTwitter}
                telegram={telegram}
                setTelegram={setTelegram}
                website={website}
                setWebsite={setWebsite}
                imageFile={imageFile}
                imagePreview={imagePreview}
                onFileSelect={handleFileSelect}
                fileRef={fileRef}
                canSubmit={canSubmit}
                submitting={submitting}
                onSubmit={submitForm}
                error={error}
              />
            </motion.div>
          )}

          {step === "deposit" && session && (
            <motion.div
              key="deposit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <DepositStep
                session={session}
                onCopy={copyAddress}
              />
            </motion.div>
          )}

          {step === "launching" && (
            <motion.div
              key="launching"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="border-y-2 rule-brass py-20 text-center"
            >
              <div className="inline-block w-12 h-12 border-2 border-brass border-t-transparent rounded-full animate-spin mb-6" />
              <p className="text-mist text-lg">
                Submitting pump.fun create + register_launch…
              </p>
            </motion.div>
          )}

          {step === "done" && session?.mint && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <DoneStep session={session} onReset={reset} />
            </motion.div>
          )}

          {step === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="border-y-2 border-red-900/40 py-12 px-6"
            >
              <p className="eyebrow mb-2 text-red-300">Error</p>
              <p className="font-mono text-sm text-mist break-all">{error}</p>
              <button onClick={reset} className="btn-outline mt-6">
                Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// FORM
// ----------------------------------------------------------------------------
function FormStep({
  name,
  setName,
  symbol,
  setSymbol,
  description,
  setDescription,
  twitter,
  setTwitter,
  telegram,
  setTelegram,
  website,
  setWebsite,
  imageFile,
  imagePreview,
  onFileSelect,
  fileRef,
  canSubmit,
  submitting,
  onSubmit,
  error,
}: {
  name: string;
  setName: (v: string) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  twitter: string;
  setTwitter: (v: string) => void;
  telegram: string;
  setTelegram: (v: string) => void;
  website: string;
  setWebsite: (v: string) => void;
  imageFile: File | null;
  imagePreview: string | null;
  onFileSelect: (f: File | null) => void;
  fileRef: React.RefObject<HTMLInputElement>;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <div className="grid grid-cols-12 gap-x-8 lg:gap-x-12">
      <div className="col-span-12 lg:col-span-7 space-y-8">
        <Field label="Name" value={name} onChange={setName} placeholder="Brutalist" maxLength={32} />
        <Field
          label="Ticker"
          value={symbol}
          onChange={(v) => setSymbol(v.toUpperCase())}
          placeholder="BRUT"
          maxLength={10}
          mono
        />
        <Field
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Optional. One sentence is enough."
          maxLength={200}
          multiline
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Field
            label="Twitter"
            value={twitter}
            onChange={setTwitter}
            placeholder="x.com/yourhandle"
            maxLength={120}
            mono
          />
          <Field
            label="Telegram"
            value={telegram}
            onChange={setTelegram}
            placeholder="t.me/yourgroup"
            maxLength={120}
            mono
          />
          <Field
            label="Website"
            value={website}
            onChange={setWebsite}
            placeholder="example.com"
            maxLength={120}
            mono
          />
        </div>

        <div>
          <label className="block">
            <span className="eyebrow-soft text-[0.6rem] tracking-widest mb-3 block">IMAGE</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add("border-brass");
              }}
              onDragLeave={(e) =>
                e.currentTarget.classList.remove("border-brass")
              }
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("border-brass");
                const f = e.dataTransfer.files?.[0];
                if (f) onFileSelect(f);
              }}
              className="border-2 border-dashed rule-strong hover:border-brass transition-colors cursor-pointer p-8 text-center"
            >
              {imagePreview ? (
                <div className="flex items-center justify-center gap-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt=""
                    className="w-24 h-24 object-cover rounded-full border-2 rule-brass"
                  />
                  <div className="text-left">
                    <p className="text-cream font-mono text-sm">
                      {imageFile?.name}
                    </p>
                    <p className="text-sky text-xs mt-1">
                      {((imageFile?.size ?? 0) / 1024).toFixed(0)} KB · click to change
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-mist">
                    Click to upload or drop an image here
                  </p>
                  <p className="text-sky text-xs mt-2 font-mono">
                    PNG / JPG / GIF · max 5MB · square recommended
                  </p>
                </>
              )}
            </div>
          </label>
        </div>

        {error && (
          <div className="border border-red-900/40 bg-red-950/20 px-4 py-3 rounded-sm">
            <p className="font-mono text-sm text-red-200">{error}</p>
          </div>
        )}

        <div className="pt-4 border-t rule flex items-center gap-4">
          <button
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
            className="btn-vault disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? "Generating wallet…" : "Generate launch wallet →"}
          </button>
          <Link href="/" className="text-sky text-sm hover:text-cream transition-colors">
            Cancel
          </Link>
        </div>
      </div>

      <aside className="col-span-12 lg:col-span-5 lg:pl-6 mt-10 lg:mt-0 text-sm text-mist leading-[1.65] border-l-2 rule-brass pl-6">
        <p className="eyebrow-soft mb-3">What happens next</p>
        <ol className="space-y-3 list-decimal pl-5 marker:text-brass marker:font-mono marker:text-xs">
          <li>
            The bank generates a fresh keypair just for this launch and shows
            you its address.
          </li>
          <li>You send <span className="kbd-pill">0.05 SOL</span> to that address from any wallet or exchange. That&apos;s the all-in cost — rent, protocol fee, network fees included.</li>
          <li>
            The bank detects the deposit, builds the pump.fun create +
            register_launch transaction, and signs + submits with the
            ephemeral keypair.
          </li>
          <li>
            Your token is live on pump.fun with the bank&apos;s vault PDA as
            the creator role. The fees flow there for the rest of the
            token&apos;s life.
          </li>
        </ol>
        <p className="text-xs text-sky mt-6 leading-[1.5]">
          The ephemeral keypair is used once and discarded. You never see it
          and never need it — pump.fun&apos;s creator role is the program&apos;s
          PDA, not this keypair.
        </p>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------------------
// DEPOSIT
// ----------------------------------------------------------------------------
function DepositStep({
  session,
  onCopy,
}: {
  session: SessionStatus;
  onCopy: () => void;
}) {
  const balanceSol = session.balance / 1e9;
  const requiredSol = session.requiredLamports / 1e9;
  const progress = Math.min(100, (balanceSol / requiredSol) * 100);

  return (
    <div className="grid grid-cols-12 gap-x-8 lg:gap-x-12">
      <div className="col-span-12 lg:col-span-7">
        <div className="border-y-2 rule-brass p-8">
          <p className="eyebrow mb-3">Deposit address</p>
          <div className="flex items-center gap-3">
            <p className="font-mono text-cream break-all text-base md:text-lg flex-1">
              {session.depositAddress}
            </p>
            <button
              onClick={onCopy}
              className="btn-outline px-3 py-2 text-xs shrink-0"
            >
              Copy
            </button>
          </div>

          <div className="mt-8 pt-6 border-t rule">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sky text-xs font-mono tracking-widest uppercase">
                Required
              </span>
              <span className="numeral text-cream text-2xl">
                {requiredSol.toFixed(2)} SOL
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sky text-xs font-mono tracking-widest uppercase">
                Received
              </span>
              <span
                className={
                  "numeral text-2xl " +
                  (session.funded ? "text-brass" : "text-cream")
                }
              >
                {balanceSol.toFixed(4)} SOL
              </span>
            </div>
            <div className="mt-4 h-1 bg-slate rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-brass"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-xs text-sky mt-4 font-mono">
              {session.funded
                ? "✓ Funded — launching automatically…"
                : "Polling every 3 seconds. Send SOL and stay on this page."}
            </p>
          </div>
        </div>

        <p className="text-xs text-sky mt-6 leading-[1.5] max-w-prose">
          Send from any wallet (Phantom, Solflare, Backpack) or an exchange.
          The deposit address is a one-time keypair held only by the bank&apos;s
          server for this session. After your launch, the wallet is empty and
          discarded.
        </p>
      </div>

      <aside className="col-span-12 lg:col-span-5 lg:pl-6 mt-10 lg:mt-0 border-l-2 rule-brass pl-6">
        <p className="eyebrow-soft mb-3">Launch preview</p>
        <div className="flex items-center gap-4 mb-6">
          {session.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.imageUrl}
              alt=""
              className="w-16 h-16 object-cover rounded-full border-2 rule-brass"
            />
          ) : null}
          <div>
            <p className="font-slab text-cream text-xl">{session.name}</p>
            <p className="font-mono text-sky text-xs">{session.symbol}</p>
          </div>
        </div>
        <p className="text-xs text-mist leading-[1.65]">
          On confirmation, your token mint becomes its own pump.fun listing
          with the bank&apos;s vault PDA set as the creator. Every trade pays
          the 0.30%–0.95% creator fee into that vault. No human can withdraw
          it.
        </p>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
function DoneStep({
  session,
  onReset,
}: {
  session: SessionStatus;
  onReset: () => void;
}) {
  return (
    <div className="border-y-2 rule-brass p-8 md:p-12">
      <p className="eyebrow mb-4">Account opened</p>
      <div className="flex items-center gap-6">
        {session.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.imageUrl}
            alt=""
            className="w-20 h-20 md:w-28 md:h-28 object-cover rounded-full border-2 rule-brass"
          />
        )}
        <div>
          <h2 className="font-slab font-medium text-cream text-3xl md:text-4xl">
            {session.name}
          </h2>
          <p className="font-mono text-sky text-sm mt-2">{session.symbol}</p>
        </div>
      </div>

      <div className="mt-8 space-y-3 border-t rule pt-6">
        <Row label="Mint" value={session.mint!} />
        <Row label="Tx" value={session.txSignature!} />
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Link
          href={`/launches/${session.mint}`}
          className="btn-vault"
        >
          View dashboard →
        </Link>
        <a
          href={`https://pump.fun/${session.mint}`}
          target="_blank"
          rel="noreferrer"
          className="btn-outline"
        >
          Trade on pump.fun ↗
        </a>
        <button onClick={onReset} className="text-sky text-sm hover:text-cream transition-colors">
          Launch another
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-12 gap-3 items-baseline">
      <span className="col-span-12 md:col-span-2 eyebrow-soft text-[0.6rem] tracking-widest">
        {label}
      </span>
      <span className="col-span-12 md:col-span-10 font-mono text-cream text-sm break-all">
        {value}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// FIELDS
// ----------------------------------------------------------------------------
function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  multiline,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  mono?: boolean;
}) {
  const cls =
    "w-full bg-transparent border-b rule-strong py-3 outline-none focus:border-brass transition-colors placeholder:text-mist/25 " +
    (mono ? "font-mono text-cream" : "text-cream");
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-2">
        <span className="eyebrow-soft text-[0.6rem] tracking-widest">
          {label}
        </span>
        {maxLength && (
          <span className="font-mono text-xs text-sky/55">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={2}
          className={cls + " resize-none"}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cls}
        />
      )}
    </label>
  );
}
