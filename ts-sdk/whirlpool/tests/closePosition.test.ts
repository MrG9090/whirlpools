import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/web3.js";
import { address, assertAccountExists } from "@solana/web3.js";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import {
  setupWhirlpool,
  setupPosition,
  setupTEPosition,
} from "./utils/program";
import { closePositionInstructions } from "../src/decreaseLiquidity";
import { rpc, sendTransaction } from "./utils/mockRpc";
import {
  fetchMaybePosition,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import assert from "assert";

const mintTypes = new Map([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFee", setupMintTEFee],
]);

const ataTypes = new Map([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFee", setupAtaTE],
]);

const poolTypes = new Map([
  ["A-B", setupWhirlpool],
  ["A-TEA", setupWhirlpool],
  ["TEA-TEB", setupWhirlpool],
  ["A-TEFee", setupWhirlpool],
]);

describe("Close Position Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const liquidity = 100_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();

  beforeAll(async () => {
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, { amount: tokenBalance }));
    }

    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }

    for (const [poolName, poolAddress] of pools) {
      const position = await setupPosition(poolAddress, {
        tickLower: -100,
        tickUpper: 100,
        liquidity,
      });
      positions.set(`position for ${poolName}`, position);
      const positionTE = await setupTEPosition(poolAddress, {
        tickLower: -100,
        tickUpper: 100,
        liquidity,
      });
      positions.set(`TE position for ${poolName}`, positionTE);
    }
  });

  const testClosePositionInstructions = async (positionName: string) => {
    const positionMint = positions.get(positionName)!;
    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    assertAccountExists(positionBefore);

    const { instructions } = await closePositionInstructions(rpc, positionMint);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionAfter.exists, false);
  };

  for (const poolName of poolTypes.keys()) {
    const positioName = `position for ${poolName}`;
    it(`Should close the ${positioName}`, async () => {
      await testClosePositionInstructions(positioName);
    });
    const tePositionName = `TE position for ${poolName}`;
    it(`Should close the ${tePositionName}`, async () => {
      await testClosePositionInstructions(tePositionName);
    });
  }

  it("Should close a position without liquidity", async () => {
    const pool = pools.get("A-B")!;
    const positionName = `position for A-B with 0 liquidity`;
    positions.set(positionName, await setupPosition(pool, {
      tickLower: -100,
      tickUpper: 100,
      liquidity: 0n,
    }));
    await testClosePositionInstructions(positionName);    
  });

  it("Should throw an error if the position mint can not be found", async () => {
    const positionMint: Address = address(
      "123456789abcdefghijkmnopqrstuvwxABCDEFGHJKL",
    );
    await assert.rejects(closePositionInstructions(rpc, positionMint));
  });
});
