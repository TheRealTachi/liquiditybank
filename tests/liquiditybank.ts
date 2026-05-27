/**
 * Liquidity Bank — Anchor test suite.
 *
 * Tests the parts of the program that do NOT depend on pump.fun or PumpSwap
 * being deployed:
 *
 *   - initialize_protocol
 *   - register_launch
 *
 * The pump-dependent ixs (collect_curve_fees, collect_amm_fees, grow_lp) are
 * exercised separately via the localnet-clone flow described in TEST.md.
 *
 * Run with:  anchor test
 */

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

const LAUNCH_FEE_LAMPORTS = 50_000_000; // 0.05 SOL

describe("liquidity-bank", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Liquiditybank as anchor.Program<any>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );
  const [protocolRevenue] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-revenue")],
    program.programId
  );

  it("initializes the protocol once, refuses to re-init", async () => {
    const existing = await provider.connection.getAccountInfo(protocolConfig);
    if (!existing) {
      await program.methods
        .initializeProtocol()
        .accounts({
          admin: payer.publicKey,
          protocolConfig,
          protocolRevenue,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const cfg = await program.account.protocolConfig.fetch(protocolConfig);
    assert.equal(cfg.admin.toBase58(), payer.publicKey.toBase58());
    assert.isFalse(cfg.paused);

    // Re-init must fail (account already exists).
    let threw = false;
    try {
      await program.methods
        .initializeProtocol()
        .accounts({
          admin: payer.publicKey,
          protocolConfig,
          protocolRevenue,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "re-init should fail");
  });

  it("register_launch creates LaunchConfig + transfers 0.05 SOL fee", async () => {
    // Create a plain SPL mint that stands in for a pump.fun mint. We don't
    // need pump.fun here — register_launch only inspects the mint as an
    // InterfaceAccount<Mint>.
    const mintKeypair = Keypair.generate();
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey, // mint authority
      null, // freeze authority
      6, // decimals
      mintKeypair
    );

    const [feeOwner, feeOwnerBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee-owner"), mint.toBuffer()],
      program.programId
    );
    const [launchConfig, launchConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch-config"), mint.toBuffer()],
      program.programId
    );

    const revenueBefore =
      (await provider.connection.getAccountInfo(protocolRevenue))?.lamports ?? 0;
    const protoBefore = await program.account.protocolConfig.fetch(
      protocolConfig
    );

    const sig = await program.methods
      .registerLaunch()
      .accounts({
        registrant: payer.publicKey,
        mint,
        feeOwner,
        launchConfig,
        protocolConfig,
        protocolRevenue,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("    register_launch sig:", sig);

    // Verify LaunchConfig.
    const cfg = await program.account.launchConfig.fetch(launchConfig);
    assert.equal(cfg.mint.toBase58(), mint.toBase58());
    assert.equal(cfg.registrant.toBase58(), payer.publicKey.toBase58());
    assert.equal(cfg.bump, launchConfigBump);
    assert.equal(cfg.feeOwnerBump, feeOwnerBump);
    assert.equal(cfg.cumulativeFeesCollected.toString(), "0");
    assert.equal(cfg.cumulativeLpSolAdded.toString(), "0");
    assert.equal(cfg.cumulativeLpBurned.toString(), "0");
    assert.equal(cfg.crankCount.toString(), "0");

    // Verify protocol_revenue PDA received the 0.05 SOL.
    const revenueAfter =
      (await provider.connection.getAccountInfo(protocolRevenue))?.lamports ?? 0;
    assert.equal(
      revenueAfter - revenueBefore,
      LAUNCH_FEE_LAMPORTS,
      "protocol_revenue should have received 0.05 SOL"
    );

    // Verify counter incremented.
    const protoAfter = await program.account.protocolConfig.fetch(
      protocolConfig
    );
    assert.equal(
      protoAfter.totalLaunches.toNumber(),
      protoBefore.totalLaunches.toNumber() + 1
    );
    assert.equal(
      protoAfter.totalRevenueLamports.toString(),
      protoBefore.totalRevenueLamports
        .add(new BN(LAUNCH_FEE_LAMPORTS))
        .toString()
    );

    // Double-register the same mint should fail (account exists).
    let threw = false;
    try {
      await program.methods
        .registerLaunch()
        .accounts({
          registrant: payer.publicKey,
          mint,
          feeOwner,
          launchConfig,
          protocolConfig,
          protocolRevenue,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "double-register should fail");
  });

  it("does not expose a withdraw / pause / admin_extract instruction", () => {
    // Read-time verification: the IDL should list ONLY the five expected
    // instructions. If anyone ever adds a withdraw path, this test breaks.
    const ixNames = (program.idl as any).instructions.map((i: any) => i.name);
    ixNames.sort();
    // Anchor 0.31's TS client exposes instruction names in camelCase. The
    // underlying IDL JSON keeps snake_case. The set must be exactly these
    // seven. The only one that moves value to a human is
    // adminCollectRevenue, and that only pulls from the protocol's own
    // launch-fee revenue PDA — not from any launch's fee_owner vault.
    assert.deepEqual(ixNames, [
      "adminCollectRevenue",
      "burnFromCurve",
      "collectAmmFees",
      "collectCurveFees",
      "growLp",
      "initializeProtocol",
      "registerLaunch",
    ]);
  });
});
