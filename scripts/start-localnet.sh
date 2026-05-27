#!/usr/bin/env bash
# Start a local Solana validator with mainnet pump.fun + PumpSwap programs cloned.
# This is the ONLY way to test liquiditybank end-to-end without spending mainnet SOL,
# because pump.fun is mainnet-only.
#
# Usage:  ./scripts/start-localnet.sh

set -euo pipefail

LEDGER_DIR=".anchor/test-ledger"

# Clean previous state
rm -rf "$LEDGER_DIR"

echo "Starting local validator with mainnet pump.fun + PumpSwap clones…"
echo "  ledger: $LEDGER_DIR"
echo

# Programs to clone from mainnet:
#   - Pump.fun bonding curve
#   - PumpSwap AMM
#   - Pump fees program (collects creator fees)
#   - Metaplex token metadata (pump.fun create depends on this)
#
# Configs / fee-recipient accounts will also need cloning for grow_lp to work;
# add them with `--clone <ADDRESS>` lines as you discover them.

solana-test-validator --reset --quiet \
  --ledger "$LEDGER_DIR" \
  --bpf-program LiqsdMHNBjXJt5XHjRq7f4H8tDwcBu4yj2cuUv6MNYi target/deploy/liquiditybank.so \
  --clone-upgradeable-program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P \
  --clone-upgradeable-program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA \
  --clone-upgradeable-program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf \
  --clone Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y \
  --clone 5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx \
  --clone 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt \
  --clone ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw \
  --clone C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw \
  --url mainnet-beta
