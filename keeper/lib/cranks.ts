/**
 * Crank transaction builders for the liquiditybank keeper.
 *
 * Pre-graduation path:  collect_curve_fees → burn_from_curve
 * Post-graduation path: collect_amm_fees   → grow_lp (not yet implemented)
 *
 * burn_from_curve mirrors scripts/burn-from-curve.ts exactly: it uses pump.fun's
 * bonding-curve `buy` as the router CPI, with min_tokens_out = 0 (max_sol_cost
 * still caps spend).
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
const { BN } = anchorPkg;
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import crypto from "node:crypto";
import pumpSwapSdk from "@pump-fun/pump-swap-sdk";
const {
  OnlinePumpAmmSdk,
  PumpAmmSdk,
  canonicalPumpPoolPda,
  lpMintPda,
  buyQuoteInput: buyQuoteInputPricing,
} = pumpSwapSdk;
import {
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  feeOwnerPda,
  launchConfigPda,
  pumpEventAuthorityPda,
  pumpAmmEventAuthorityPda,
  pumpCreatorVaultPda,
  pumpGlobalPda,
  pumpBondingCurvePda,
  pumpGlobalVolumeAccumulatorPda,
  pumpUserVolumeAccumulatorPda,
  pumpFeeConfigPda,
  pumpAmmCreatorVaultAuthorityPda,
} from "./programs.js";

// Anchor sighash("global:buy") — pump.fun bonding-curve buy ix.
const PUMP_BUY_IX_DISCRIM = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
// fee_recipient offset inside pump.fun's global PDA: 8 + 1 + 32 = 41.
const PUMP_GLOBAL_FEE_RECIPIENT_OFFSET = 41;
// FEE_OWNER_RESERVE (0.01) + CRANK_REWARD (0.001) held back in fee_owner.
const RESERVE_LAMPORTS = 11_000_000;
// bonding_curve.complete bool offset.
const BONDING_CURVE_COMPLETE_OFFSET = 48;

/** Returns true if the mint has graduated off the pump.fun bonding curve. */
export async function isGraduated(
  program: any,
  mint: PublicKey
): Promise<boolean> {
  const conn = program.provider.connection;
  const [bondingCurve] = pumpBondingCurvePda(mint);
  const info = await conn.getAccountInfo(bondingCurve);
  // No bonding curve account → treat as graduated / non-pump. complete=1 → graduated.
  if (!info) return true;
  return info.data.readUInt8(BONDING_CURVE_COMPLETE_OFFSET) === 1;
}

/** Permissionless poke: pulls pump.fun bonding-curve creator fees into fee_owner (bare SOL). */
export async function collectCurveFees(
  program: any,
  cranker: Keypair,
  mint: PublicKey
): Promise<string> {
  const [feeOwner] = feeOwnerPda(mint);
  const [launchConfig] = launchConfigPda(mint);
  const [creatorVault] = pumpCreatorVaultPda(feeOwner);
  const [pumpEventAuthority] = pumpEventAuthorityPda();

  return program.methods
    .collectCurveFees()
    .accounts({
      cranker: cranker.publicKey,
      mint,
      launchConfig,
      feeOwner,
      creatorVault,
      pumpEventAuthority,
      pumpProgram: PUMP_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Pulls PumpSwap (post-grad) WSOL creator fees into fee_owner's WSOL ATA. */
export async function collectAmmFees(
  program: any,
  cranker: Keypair,
  mint: PublicKey
): Promise<string> {
  const [feeOwner] = feeOwnerPda(mint);
  const [launchConfig] = launchConfigPda(mint);
  const [coinCreatorVaultAuthority] = pumpAmmCreatorVaultAuthorityPda(feeOwner);
  const [pumpAmmEventAuthority] = pumpAmmEventAuthorityPda();

  const coinCreatorVaultAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    coinCreatorVaultAuthority,
    true
  );
  const feeOwnerWsolAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    feeOwner,
    true
  );

  const ix = await program.methods
    .collectAmmFees()
    .accounts({
      cranker: cranker.publicKey,
      mint,
      launchConfig,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      feeOwner,
      coinCreatorVaultAuthority,
      coinCreatorVaultAta,
      feeOwnerWsolAta,
      pumpAmmEventAuthority,
      pumpAmmProgram: PUMP_AMM_PROGRAM_ID,
    })
    .instruction();

  // Ensure the destination WSOL ATA exists before the CPI deposits into it.
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      cranker.publicKey,
      feeOwnerWsolAta,
      feeOwner,
      NATIVE_MINT
    ),
    ix
  );
  return program.provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

/**
 * Pre-graduation buy-and-burn. Spends fee_owner's accumulated SOL on a pump.fun
 * `buy` (router CPI) and SPL-burns the tokens. Mirrors scripts/burn-from-curve.ts.
 * Caller must have verified fee_owner SOL ≥ threshold and that the token is pre-grad.
 */
export async function burnFromCurve(
  program: any,
  cranker: Keypair,
  mint: PublicKey
): Promise<string> {
  const conn = program.provider.connection;
  const [feeOwner] = feeOwnerPda(mint);
  const [launchConfig] = launchConfigPda(mint);

  const feeOwnerSol: number = await conn.getBalance(feeOwner);

  const [bondingCurve] = pumpBondingCurvePda(mint);
  const bcInfo = await conn.getAccountInfo(bondingCurve);
  if (!bcInfo) throw new Error("no pump.fun bonding_curve for this mint");
  if (bcInfo.data.readUInt8(BONDING_CURVE_COMPLETE_OFFSET) === 1) {
    throw new Error("bonding curve has graduated — use grow_lp instead");
  }
  const vTokR: bigint = BigInt(bcInfo.data.readBigUInt64LE(8));
  const vSolR: bigint = BigInt(bcInfo.data.readBigUInt64LE(16));

  const swapAmount: number = feeOwnerSol - RESERVE_LAMPORTS;
  // Constant-product math with pump.fun's 1% input fee; shave 5% off gross
  // tokens-out as margin (max_sol_cost still caps loss).
  const solAfterFee = (BigInt(swapAmount) * 99n) / 100n;
  const newVSolR = vSolR + solAfterFee;
  const newVTokR = (vTokR * vSolR) / newVSolR;
  const grossOut = vTokR - newVTokR;
  const buyAmount = (grossOut * 95n) / 100n;

  const [pumpGlobal] = pumpGlobalPda();
  const globalAccount = await conn.getAccountInfo(pumpGlobal);
  if (!globalAccount) throw new Error("pump.fun global PDA not found");
  const pumpFeeRecipient = new PublicKey(
    globalAccount.data.subarray(
      PUMP_GLOBAL_FEE_RECIPIENT_OFFSET,
      PUMP_GLOBAL_FEE_RECIPIENT_OFFSET + 32
    )
  );

  const pumpAssociatedBondingCurve = await getAssociatedTokenAddress(
    mint,
    bondingCurve,
    true
  );
  const [pumpCreatorVault] = pumpCreatorVaultPda(feeOwner);
  const [pumpEventAuthority] = pumpEventAuthorityPda();
  const [pumpGlobalVolumeAccumulator] = pumpGlobalVolumeAccumulatorPda();
  const [pumpUserVolumeAccumulator] = pumpUserVolumeAccumulatorPda(feeOwner);
  const [pumpFeeConfig] = pumpFeeConfigPda();

  const feeOwnerTokenAta = await getAssociatedTokenAddress(mint, feeOwner, true);
  const feeOwnerWsolAta = await getAssociatedTokenAddress(
    NATIVE_MINT,
    feeOwner,
    true
  );

  // pump.fun buy ix accounts (16, in documented order).
  const pumpBuyAccounts = [
    { pubkey: pumpGlobal, isWritable: false, isSigner: false },
    { pubkey: pumpFeeRecipient, isWritable: true, isSigner: false },
    { pubkey: mint, isWritable: false, isSigner: false },
    { pubkey: bondingCurve, isWritable: true, isSigner: false },
    { pubkey: pumpAssociatedBondingCurve, isWritable: true, isSigner: false },
    { pubkey: feeOwnerTokenAta, isWritable: true, isSigner: false },
    { pubkey: feeOwner, isWritable: true, isSigner: true },
    { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: pumpCreatorVault, isWritable: true, isSigner: false },
    { pubkey: pumpEventAuthority, isWritable: false, isSigner: false },
    { pubkey: PUMP_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: pumpGlobalVolumeAccumulator, isWritable: true, isSigner: false },
    { pubkey: pumpUserVolumeAccumulator, isWritable: true, isSigner: false },
    { pubkey: pumpFeeConfig, isWritable: false, isSigner: false },
    { pubkey: PUMP_FEES_PROGRAM_ID, isWritable: false, isSigner: false },
  ];

  // buy(amount: u64, max_sol_cost: u64)
  const routerData = Buffer.alloc(8 + 8 + 8);
  PUMP_BUY_IX_DISCRIM.copy(routerData, 0);
  routerData.writeBigUInt64LE(buyAmount, 8);
  routerData.writeBigUInt64LE(BigInt(swapAmount), 16);

  // Flag byte per account: bit0 = is_writable, bit1 = is_signer. The program
  // re-derives is_signer and only signs for fee_owner via invoke_signed.
  const flags = Buffer.alloc(pumpBuyAccounts.length);
  const remainingAccounts = pumpBuyAccounts.map((a, i) => {
    let f = 0;
    if (a.isWritable) f |= 0b01;
    if (a.isSigner) f |= 0b10;
    flags[i] = f;
    return { pubkey: a.pubkey, isSigner: false, isWritable: a.isWritable };
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      cranker.publicKey,
      feeOwnerTokenAta,
      feeOwner,
      mint
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      cranker.publicKey,
      feeOwnerWsolAta,
      feeOwner,
      NATIVE_MINT
    )
  );

  const burnIx = await program.methods
    .burnFromCurve(routerData, flags, new BN(0)) // min_tokens_out = 0 (mirror local)
    .accounts({
      cranker: cranker.publicKey,
      mint,
      launchConfig,
      feeOwner,
      feeOwnerTokenAta,
      feeOwnerWsolAta,
      quoteMint: NATIVE_MINT,
      routerProgram: PUMP_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
  tx.add(burnIx);

  return program.provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

// =============================================================================
// grow_lp (post-graduation) — GATED OFF by default, UNTESTED against a real pool.
// =============================================================================
//
// Buys ~50% of fee_owner's WSOL for tokens via PumpSwap, then deposits the
// bought tokens + remaining WSOL as LP via PumpSwap; the on-chain program then
// SPL-burns the received LP. Both legs are forwarded by grow_lp's router CPI,
// signed by the fee_owner PDA.
//
// We build the PumpSwap `buy` and `deposit` instructions with the official
// @pump-fun/pump-swap-sdk (authoritative for discriminators/accounts), extract
// the single bare program instruction from each (the SDK also emits WSOL-wrap /
// ATA-setup ixs we don't want — grow_lp manages WSOL itself), and re-pack their
// accounts into grow_lp's remaining_accounts + flag bytes.
//
// UNVALIDATED — must be tested against a real graduated pool before trusting it
// unattended (index.ts gates this behind ENABLE_GROW_LP):
//   - the deposit is sized off PRE-buy pool reserves; the on-chain buy shifts
//     the ratio, so we deposit only ~90% of the bought base and let the rest
//     roll into the next crank (min_lp_out = 0).
//   - the GROW_LP_SLIPPAGE unit/value passed to the SDK is a guess.
// Risk is bounded: the program has no withdraw/drain path (value stays as pool
// liquidity or in fee_owner) and a malformed tx fails at preflight. Residual
// real risk is MEV on the min_out=0 buy (user-accepted, "mirror local").

function anchorIxDiscriminator(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}
const PUMP_BUY_DISCRIM = anchorIxDiscriminator("buy");
const PUMP_DEPOSIT_DISCRIM = anchorIxDiscriminator("deposit");

/** Pull the single bare PumpSwap program ix (matching `discrim`) from an SDK ix array. */
function extractPumpAmmIx(
  ixs: TransactionInstruction[],
  discrim: Buffer
): TransactionInstruction {
  const found = ixs.find(
    (ix) =>
      ix.programId.equals(PUMP_AMM_PROGRAM_ID) &&
      Buffer.from(ix.data.subarray(0, 8)).equals(discrim)
  );
  if (!found) throw new Error("could not extract PumpSwap ix from SDK output");
  return found;
}

/**
 * Convert an ix's account metas into grow_lp's router format: one flag byte per
 * account (bit0=writable, bit1=signer), accounts marked NOT-signer (the program
 * re-derives is_signer and only signs for fee_owner via invoke_signed).
 */
function packRouterAccounts(ix: TransactionInstruction): {
  flags: Buffer;
  remaining: AccountMeta[];
} {
  const flags = Buffer.alloc(ix.keys.length);
  const remaining: AccountMeta[] = ix.keys.map((k, i) => {
    let f = 0;
    if (k.isWritable) f |= 0b01;
    if (k.isSigner) f |= 0b10;
    flags[i] = f;
    return { pubkey: k.pubkey, isSigner: false, isWritable: k.isWritable };
  });
  return { flags, remaining };
}

/**
 * Post-graduation buy + deposit + burn-LP. Caller must have verified the token
 * is graduated and fee_owner's WSOL ATA holds ≥ threshold. Only invoked when
 * ENABLE_GROW_LP is set (see index.ts).
 */
export async function growLp(
  program: any,
  cranker: Keypair,
  mint: PublicKey
): Promise<string> {
  const conn = program.provider.connection;
  const slippage = Number(process.env.GROW_LP_SLIPPAGE ?? 5);

  const [feeOwner] = feeOwnerPda(mint);
  const [launchConfig] = launchConfigPda(mint);

  const pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
  const lpMint = lpMintPda(pool);

  const feeOwnerWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, feeOwner, true);
  const feeOwnerTokenAta = await getAssociatedTokenAddress(mint, feeOwner, true);
  const feeOwnerLpAta = await getAssociatedTokenAddress(lpMint, feeOwner, true);

  const wsolBal = BigInt(
    (await conn.getTokenAccountBalance(feeOwnerWsolAta)).value.amount
  );
  const quoteForSwap = new BN((wsolBal / 2n).toString());

  const online = new OnlinePumpAmmSdk(conn);
  const offline = new PumpAmmSdk();

  // --- buy leg: spend ~50% of WSOL on tokens ---
  const swapState = await online.swapSolanaState(
    pool,
    feeOwner,
    feeOwnerTokenAta,
    feeOwnerWsolAta
  );
  const buyIxs = await offline.buyQuoteInput(swapState, quoteForSwap, slippage);
  const buyIx = extractPumpAmmIx(buyIxs, PUMP_BUY_DISCRIM);

  // expected base out, to size the deposit conservatively (90%; rest rolls over)
  const buyEstimate = buyQuoteInputPricing({
    quote: quoteForSwap,
    slippage,
    baseReserve: swapState.poolBaseAmount,
    quoteReserve: swapState.poolQuoteAmount,
    globalConfig: swapState.globalConfig,
    baseMintAccount: swapState.baseMintAccount,
    baseMint: mint,
    coinCreator: swapState.pool.coinCreator,
    creator: swapState.pool.creator,
    feeConfig: swapState.feeConfig,
  });
  const baseForDeposit = buyEstimate.base.muln(90).divn(100);

  // --- deposit leg: add bought tokens + matching WSOL as LP ---
  const liqState = await online.liquiditySolanaState(
    pool,
    feeOwner,
    feeOwnerTokenAta,
    feeOwnerWsolAta,
    feeOwnerLpAta
  );
  const { lpToken } = offline.depositAutocompleteQuoteAndLpTokenFromBase(
    liqState,
    baseForDeposit,
    slippage
  );
  const depositIxs = await offline.depositInstructions(liqState, lpToken, slippage);
  const depositIx = extractPumpAmmIx(depositIxs, PUMP_DEPOSIT_DISCRIM);

  const buyPack = packRouterAccounts(buyIx);
  const depPack = packRouterAccounts(depositIx);

  console.log(
    `    grow_lp: wsol=${(Number(wsolBal) / 1e9).toFixed(4)} ` +
      `swap=${(Number(quoteForSwap.toString()) / 1e9).toFixed(4)} ` +
      `baseOut≈${buyEstimate.base.toString()} lpOut≈${lpToken.toString()}`
  );

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      cranker.publicKey,
      feeOwnerTokenAta,
      feeOwner,
      mint
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      cranker.publicKey,
      feeOwnerLpAta,
      feeOwner,
      lpMint
    )
  );

  const growIx = await program.methods
    .growLp(buyIx.data, buyPack.flags, depositIx.data, depPack.flags, new BN(0), new BN(0))
    .accounts({
      cranker: cranker.publicKey,
      mint,
      launchConfig,
      feeOwner,
      feeOwnerTokenAta,
      feeOwnerWsolAta,
      feeOwnerLpAta,
      lpMint,
      swapRouterProgram: PUMP_AMM_PROGRAM_ID,
      depositRouterProgram: PUMP_AMM_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([...buyPack.remaining, ...depPack.remaining])
    .instruction();
  tx.add(growIx);

  return program.provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}
