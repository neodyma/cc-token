import assert from "node:assert/strict";
import { test } from "node:test";

import { AccountRole, address, generateKeyPairSigner } from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  getCollectionAddress,
  getMergeNativePositionsInstruction,
  getNativePositionSetupInstructions,
  getPositionAddress,
  getPositionBalanceAddress,
  getSplitNativePositionInstruction,
  ROOT_COLLECTION_ID,
  type IndexSetWords,
} from "../src/index.ts";

const resolver = address("11111111111111111111111111111111");
const mint = address("So11111111111111111111111111111111111111112");

function indexSet(...outcomes: number[]): IndexSetWords {
  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  for (const outcome of outcomes) {
    words[Math.floor(outcome / 64)] |= 1n << BigInt(outcome % 64);
  }
  return words;
}

test("builds root-parent partial refinement with its composed union boundary", async () => {
  const owner = await generateKeyPairSigner();
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(31), 3);
  const partition = [indexSet(0), indexSet(1)] as const;
  const union = indexSet(0, 1);
  const boundaryCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    conditionId,
    union,
  ).collectionId;
  const boundaryPositionId = derivePositionId(mint, boundaryCollectionId);
  const input = {
    owner,
    collateralMint: mint,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    outcomeCount: 3,
    partition,
    amount: 25n,
  };

  for (const instruction of [
    await getSplitNativePositionInstruction(input),
    await getMergeNativePositionsInstruction(input),
  ]) {
    assert.equal(instruction.accounts?.length, 9);
    assert.equal(
      instruction.accounts?.[2]?.address,
      (await getPositionAddress(boundaryPositionId))[0],
    );
    assert.equal(
      instruction.accounts?.[3]?.address,
      (await getPositionBalanceAddress(owner.address, boundaryPositionId))[0],
    );
    assert.equal(instruction.accounts?.[4]?.address, CC_TOKEN_PROGRAM_ADDRESS);

    for (let index = 0; index < partition.length; index += 1) {
      const collectionId = deriveCollectionId(
        ROOT_COLLECTION_ID,
        conditionId,
        partition[index]!,
      ).collectionId;
      const positionId = derivePositionId(mint, collectionId);
      assert.equal(
        instruction.accounts?.[5 + index * 2]?.address,
        (await getPositionAddress(positionId))[0],
      );
      assert.equal(instruction.accounts?.[5 + index * 2]?.role, AccountRole.READONLY);
      assert.equal(
        instruction.accounts?.[6 + index * 2]?.address,
        (await getPositionBalanceAddress(owner.address, positionId))[0],
      );
      assert.equal(instruction.accounts?.[6 + index * 2]?.role, AccountRole.WRITABLE);
    }
  }

  const setup = await getNativePositionSetupInstructions({
    payer: owner,
    owner: owner.address,
    collateralMint: mint,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    outcomeCount: 3,
    partition,
  });
  assert.equal(setup.length, 9);
});

test("uses a registered non-root parent as the full-partition boundary", async () => {
  const owner = await generateKeyPairSigner();
  const parentConditionId = deriveConditionId(resolver, new Uint8Array(32).fill(32), 8);
  const parentCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    parentConditionId,
    indexSet(0, 1, 2),
  ).collectionId;
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(33), 2);
  const partition = [indexSet(0), indexSet(1)] as const;
  const boundaryPositionId = derivePositionId(mint, parentCollectionId);
  const instruction = await getSplitNativePositionInstruction({
    owner,
    collateralMint: mint,
    parentCollectionId,
    conditionId,
    outcomeCount: 2,
    partition,
    amount: 10n,
  });

  assert.equal(
    instruction.accounts?.[2]?.address,
    (await getPositionAddress(boundaryPositionId))[0],
  );
  assert.equal(
    instruction.accounts?.[4]?.address,
    (await getCollectionAddress(parentCollectionId))[0],
  );

  const setup = await getNativePositionSetupInstructions({
    payer: owner,
    owner: owner.address,
    collateralMint: mint,
    parentCollectionId,
    conditionId,
    outcomeCount: 2,
    partition,
  });
  assert.equal(setup.length, 8);
});

test("accepts repeated-condition factors and rejects invalid native routes", async () => {
  const owner = await generateKeyPairSigner();
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(34), 3);
  const parentCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    conditionId,
    indexSet(0),
  ).collectionId;
  await getSplitNativePositionInstruction({
    owner,
    collateralMint: mint,
    parentCollectionId,
    conditionId,
    outcomeCount: 3,
    partition: [indexSet(0, 1), indexSet(2)],
    amount: 1n,
  });

  await assert.rejects(
    () =>
      getSplitNativePositionInstruction({
        owner,
        collateralMint: mint,
        parentCollectionId: ROOT_COLLECTION_ID,
        conditionId,
        outcomeCount: 3,
        partition: [indexSet(0, 1), indexSet(2)],
        amount: 1n,
      }),
    /collateral instruction/,
  );
  await assert.rejects(
    () =>
      getMergeNativePositionsInstruction({
        owner,
        collateralMint: mint,
        parentCollectionId,
        conditionId,
        outcomeCount: 3,
        partition: [indexSet(0), indexSet(1)],
        amount: 0n,
      }),
    /amount/,
  );
  await assert.rejects(
    () =>
      getSplitNativePositionInstruction({
        owner,
        collateralMint: mint,
        parentCollectionId,
        conditionId,
        outcomeCount: 3,
        partition: [indexSet(0, 1), indexSet(1, 2)],
        amount: 1n,
      }),
    /overlap/,
  );
});
