"use client";

import { useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  useWalletModal,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

// Inline styles for the wallet-adapter modal, kept minimal so it doesn't
// fight the rest of our design. Loaded from CDN to avoid the heavy npm
// css import.
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("mainnet-beta");

// Cast around a @types/react vs wallet-adapter peer-dep mismatch where the
// newer ReactNode includes Promise<ReactNode>. Runtime is unaffected.
const ConnP = ConnectionProvider as any;
const WP = WalletProvider as any;
const WMP = WalletModalProvider as any;

export function WalletShell({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => RPC, []);
  // Backpack and other Wallet-Standard wallets are auto-detected without an
  // explicit adapter. We only register adapters for the wallets that aren't
  // Wallet-Standard compliant yet.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnP endpoint={endpoint}>
      <WP wallets={wallets} autoConnect>
        <WMP>{children}</WMP>
      </WP>
    </ConnP>
  );
}

function shorten(addr: string, n = 4) {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function ConnectButton() {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [hover, setHover] = useState(false);

  if (connected && publicKey) {
    return (
      <button
        onClick={() => disconnect()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="btn-outline font-mono text-xs px-3 py-1.5"
      >
        {hover ? "Disconnect" : shorten(publicKey.toBase58(), 4)}
      </button>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="btn-vault font-slab text-xs px-4 py-1.5"
    >
      Connect
    </button>
  );
}

