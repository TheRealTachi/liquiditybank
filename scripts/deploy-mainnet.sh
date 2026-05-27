#!/usr/bin/env bash
# Mainnet deploy for Liquidity Bank.
#
# Walks you through pre-flight, then runs `anchor deploy` against mainnet-beta.
# Aborts on any check failure — no surprises.

set -euo pipefail

PROGRAM_ID="LiqsdMHNBjXJt5XHjRq7f4H8tDwcBu4yj2cuUv6MNYi"
EXPECTED_FILE_SIZE_KB=274
EXPECTED_DEPLOY_SOL=2.0

cd "$(dirname "$0")/.."

echo "=================================================="
echo "  Liquidity Bank — mainnet deploy"
echo "=================================================="
echo "  program:  $PROGRAM_ID"
echo

# ---------- 1. Sanity: binary exists and is the right size ----------
if [[ ! -f target/deploy/liquiditybank.so ]]; then
  echo "✗ target/deploy/liquiditybank.so not found. Run 'anchor build' first."
  exit 1
fi
SIZE_KB=$(( $(stat -f%z target/deploy/liquiditybank.so 2>/dev/null || stat -c%s target/deploy/liquiditybank.so) / 1024 ))
if (( SIZE_KB > 320 )); then
  echo "✗ liquiditybank.so is $SIZE_KB KB — larger than expected (~$EXPECTED_FILE_SIZE_KB KB)."
  echo "  Did you build without size optimization? Check Cargo.toml [profile.release]."
  exit 1
fi
echo "✓ liquiditybank.so: $SIZE_KB KB"

# ---------- 2. Confirm declare_id matches ----------
DECLARED=$(grep -oE 'declare_id!\("[A-Za-z0-9]+"\)' programs/liquiditybank/src/lib.rs | grep -oE '"[A-Za-z0-9]+"' | tr -d '"')
if [[ "$DECLARED" != "$PROGRAM_ID" ]]; then
  echo "✗ declare_id! in lib.rs ($DECLARED) doesn't match expected ($PROGRAM_ID)."
  echo "  Run 'anchor keys sync' and rebuild."
  exit 1
fi
echo "✓ declare_id! synced"

# ---------- 3. Confirm we're on mainnet-beta ----------
solana config set --url mainnet-beta > /dev/null
RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo "✓ cluster: $RPC"

# ---------- 4. Wallet balance check ----------
WALLET=$(solana address)
BAL=$(solana balance | awk '{print $1}')
echo "  wallet:   $WALLET"
echo "  balance:  $BAL SOL"

# bc isn't always installed; do floating compare in awk
NEEDED_OK=$(echo "$BAL $EXPECTED_DEPLOY_SOL" | awk '{print ($1 >= $2) ? "1" : "0"}')
if [[ "$NEEDED_OK" != "1" ]]; then
  echo "✗ insufficient balance. Need at least ${EXPECTED_DEPLOY_SOL} SOL for deploy."
  echo "  Send SOL to $WALLET and re-run."
  exit 1
fi
echo "✓ balance sufficient (need ~$EXPECTED_DEPLOY_SOL SOL)"

# ---------- 5. Final confirmation ----------
echo
echo "About to deploy:"
echo "  program ID:  $PROGRAM_ID"
echo "  size:        $SIZE_KB KB"
echo "  est. cost:   ~$EXPECTED_DEPLOY_SOL SOL"
echo "  cluster:     mainnet-beta"
echo "  wallet:      $WALLET"
echo
read -p "Proceed? [type 'yes' to deploy] " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "aborted."
  exit 0
fi

# ---------- 6. Deploy ----------
echo
echo "deploying…"
anchor deploy --provider.cluster mainnet

echo
echo "✓ deploy complete."
echo
echo "Next step:"
echo "  cd keeper"
echo "  RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/init-protocol.ts"
