import assert from "node:assert/strict";
import { test } from "node:test";

import { address, generateKeyPairSigner } from "@solana/kit";

import {
  deriveCollectionId,
  derivePositionId,
  getPositionAddress,
  getPositionBalanceAddress,
  getRedeemNativePositionInstruction,
  getRedeemNativePositionSetupInstructions,
  getRedeemRootCollateralInstruction,
  ROOT_COLLECTION_ID,
} from "../src/index.ts";
import { getRedeemPositionInstructionDataDecoder } from "../src/generated/index.ts";

const collateralMint = address("So11111111111111111111111111111111111111112");
const tokenAccount = address("SysvarRent111111111111111111111111111111111");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const conditionId = new Uint8Array(32).fill(3);
const indexSet = [1n, 0n, 0n, 0n] as const;
const parentCollectionId = deriveCollectionId(
  ROOT_COLLECTION_ID,
  new Uint8Array(32).fill(4),
  indexSet,
).collectionId;

test("builds residual redemption from the composed source to its parent", async () => {
  const owner = await generateKeyPairSigner();
  const instruction = await getRedeemNativePositionInstruction({
    owner,
    collateralMint,
    parentCollectionId,
    conditionId,
    outcomeCount: 2,
    indexSet,
    amount: 100n,
  });
  const sourceCollectionId = deriveCollectionId(
    parentCollectionId,
    conditionId,
    indexSet,
  ).collectionId;
  const sourcePositionId = derivePositionId(collateralMint, sourceCollectionId);
  const destinationPositionId = derivePositionId(collateralMint, parentCollectionId);

  assert.equal(instruction.accounts?.length, 8);
  assert.equal(instruction.accounts?.[3]?.address, (await getPositionAddress(sourcePositionId))[0]);
  assert.equal(
    instruction.accounts?.[4]?.address,
    (await getPositionBalanceAddress(owner.address, sourcePositionId))[0],
  );
  assert.equal(
    instruction.accounts?.[5]?.address,
    (await getPositionAddress(destinationPositionId))[0],
  );
  assert.equal(
    instruction.accounts?.[6]?.address,
    (await getPositionBalanceAddress(owner.address, destinationPositionId))[0],
  );
  const data = getRedeemPositionInstructionDataDecoder().decode(instruction.data!);
  assert.deepEqual(data.args.conditionId, conditionId);
  assert.deepEqual(data.args.indexSet.words, indexSet);
  assert.equal(data.args.amount, 100n);

  const setup = await getRedeemNativePositionSetupInstructions({
    payer: owner,
    collateralMint,
    parentCollectionId,
  });
  assert.equal(setup.length, 1);
});

test("builds root redemption against the canonical source position", async () => {
  const owner = await generateKeyPairSigner();
  const instruction = await getRedeemRootCollateralInstruction({
    owner,
    ownerTokenAccount: tokenAccount,
    collateralMint,
    tokenProgram,
    conditionId,
    outcomeCount: 2,
    indexSet,
    amount: 50n,
  });
  const sourceCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    conditionId,
    indexSet,
  ).collectionId;
  const sourcePositionId = derivePositionId(collateralMint, sourceCollectionId);

  assert.equal(instruction.accounts?.length, 10);
  assert.equal(instruction.accounts?.[7]?.address, (await getPositionAddress(sourcePositionId))[0]);
  assert.equal(
    instruction.accounts?.[8]?.address,
    (await getPositionBalanceAddress(owner.address, sourcePositionId))[0],
  );
});

test("rejects invalid redemption requests before building", async () => {
  const owner = await generateKeyPairSigner();
  await assert.rejects(
    () =>
      getRedeemNativePositionInstruction({
        owner,
        collateralMint,
        parentCollectionId: ROOT_COLLECTION_ID,
        conditionId,
        outcomeCount: 2,
        indexSet,
        amount: 1n,
      }),
    /collateral instruction/,
  );
  await assert.rejects(
    () =>
      getRedeemRootCollateralInstruction({
        owner,
        ownerTokenAccount: tokenAccount,
        collateralMint,
        tokenProgram,
        conditionId,
        outcomeCount: 2,
        indexSet,
        amount: 0n,
      }),
    /amount/,
  );
  await assert.rejects(
    () =>
      getRedeemNativePositionSetupInstructions({
        payer: owner,
        collateralMint,
        parentCollectionId: ROOT_COLLECTION_ID,
      }),
    /does not create/,
  );
});
