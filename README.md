# liquiditybank

**Self-deepening permanent liquidity for pump.fun launches.**

Every pump.fun creator-fee SOL routed into the program is used to buy tokens,
pair them as LP, and **burn** the resulting LP tokens. Pool depth grows
monotonically with trading activity. The program holds no withdrawal
instruction for the LP — once burned, it is permanent.

## Status

**Live on Solana mainnet.**

| | |
|---|---|
| Program ID | `LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W` |
| Verified build | ✅ [verify.osec.io](https://verify.osec.io/status/LiqARcPPdkvPhjasWYVHtKMY6nDsz1C3ANY9HdcRG5W) |
| Frontend | https://x.com/xchangeagents |

## What the program does

```
┌─────────────────────────┐
│ Pump.fun trade happens  │
│  creator fees stream    │
│  into fee_owner PDA     │
└──────────┬──────────────┘
           │
   ┌───────▼────────┐    ┌─────────────────┐
   │ collect_curve  │    │ collect_amm     │
   │ _fees (crank)  │ or │ _fees (crank)   │
   │  curve→fee_own │    │  amm→fee_own    │
   └───────┬────────┘    └────────┬────────┘
           │                      │
           └──────────┬───────────┘
                      │
              ┌───────▼────────┐
              │   grow_lp      │   (≥ 0.5 SOL threshold)
              │   (crank)      │
              │                │
              │  1. swap half  │   router CPI (Jupiter / PumpSwap)
              │  2. deposit    │   PumpSwap deposit
              │  3. burn LP    │   SPL Token Burn (real supply reduction)
              │  4. pay cranker│
              └────────────────┘
```

Result: trading activity → permanent LP depth, forever.

## Architecture

Each launch has three PDAs derived from its mint:

| PDA | Seeds | Purpose |
|---|---|---|
| `fee_owner` | `["fee-owner", mint]` | pump.fun creator role + SOL/WSOL custody. Bare account, no data. |
| `launch_config` | `["launch-config", mint]` | Immutable per-launch params + cumulative counters. |
| Protocol singletons | `["protocol-config"]`, `["protocol-revenue"]` | Admin + revenue sink. |

The `fee_owner` is the entire trust property. It's a PDA, so no one holds the
keys — not the dev, not the protocol admin. The program's instruction set is
the totality of what can ever happen to its funds. There is no `withdraw_to`,
no `update_authority`, no admin escape hatch.

## Instructions

### `initialize_protocol`

One-time admin setup. Creates the `protocol_config` and the `protocol_revenue`
lamport-sink PDA. Called once at deploy time.

### `register_launch`

Wires an existing pump.fun token (whose creator is already `fee_owner_pda(mint)`)
into the program. Costs **0.02 SOL**, paid into `protocol_revenue`. Sized so
the launcher's all-in deposit (rent + tx fees + this fee + buffer) fits inside
0.05 SOL. The frontend handles the pump.fun `create` tx separately with
`fee_owner` set as the creator before calling this.

### `collect_curve_fees`

Permissionless crank. Pulls SOL creator fees from the pump.fun bonding curve
into `fee_owner`.

### `collect_amm_fees`

Permissionless crank. Pulls WSOL creator fees from the PumpSwap pool's
`coin_creator` vault into `fee_owner`'s WSOL ATA. Used after the token
graduates from the bonding curve.

### `burn_from_curve`

Pre-graduation crank. Spends accumulated SOL on a router CPI (typically a
direct pump.fun `buy`) and SPL-burns the resulting tokens. Fires when
`fee_owner` holds ≥ 0.5 SOL.

### `grow_lp`

Post-graduation crank. Fires when `fee_owner_wsol_ata` ≥ 0.5 SOL:

1. Buy tokens with half the WSOL via a swap router CPI
2. Deposit both halves as LP via PumpSwap `deposit`
3. SPL-burn the received LP tokens (decrements `lp_mint.supply`)
4. Pay 0.001 SOL crank reward to the caller
5. Update cumulative counters

Slippage is bounded by `min_tokens_out_from_swap` and `min_lp_out` args.

## Build

```bash
anchor build
```

For a deterministic build that matches the on-chain bytecode:

```bash
solana-verify build --library-name liquiditybank \
  --base-image solanafoundation/solana-verifiable-build:3.1.14
```

## License

TBD.
