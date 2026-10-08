import assert from "node:assert/strict";
import { test } from "node:test";

import { address, generateKeyPairSigner, AccountRole } from "@solana/kit";

import {
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  getMergeRootCollateralInstruction,
  getPositionAddress,
  getPositionBalanceAddress,
  getRootCollateralSetupInstructions,
  getSplitRootCollateralInstruction,
  ROOT_COLLECTION_ID,
  TOKEN_2022_PROGRAM_ADDRESS,
  type IndexSetWords,
} from "../src/index.ts";
import { getSplitFromCollateralInstructionDataDecoder } from "../src/generated/index.ts";

const resolver = address("11111111111111111111111111111111");
const mint = address("So11111111111111111111111111111111111111112");
const ownerTokenAccount = address("Vote111111111111111111111111111111111111111");
const partition = [
  [1n, 0n, 0n, 0n],
  [2n, 0n, 0n, 0n],
] as const satisfies readonly IndexSetWords[];

test("builds root collateral instructions with ordered position pairs", async () => {
  const owner = await generateKeyPairSigner();
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(91), 2);
  const input = {
    owner,
    ownerTokenAccount,
    collateralMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    conditionId,
    outcomeCount: 2,
    partition,
    amount: 50n,
  };

  for (const instruction of [
    await getSplitRootCollateralInstruction(input),
    await getMergeRootCollateralInstruction(input),
  ]) {
    assert.equal(instruction.accounts?.length, 12);
    assert.equal(instruction.accounts?.[7]?.address, TOKEN_2022_PROGRAM_ADDRESS);
    for (let index = 0; index < partition.length; index += 1) {
      const collectionId = deriveCollectionId(
        ROOT_COLLECTION_ID,
        conditionId,
        partition[index]!,
      ).collectionId;
      const positionId = derivePositionId(mint, collectionId);
      assert.equal(
        instruction.accounts?.[8 + index * 2]?.address,
        (await getPositionAddress(positionId))[0],
      );
      assert.equal(instruction.accounts?.[8 + index * 2]?.role, AccountRole.READONLY);
      assert.equal(
        instruction.accounts?.[9 + index * 2]?.address,
        (await getPositionBalanceAddress(owner.address, positionId))[0],
      );
      assert.equal(instruction.accounts?.[9 + index * 2]?.role, AccountRole.WRITABLE);
    }
  }

  const setup = await getRootCollateralSetupInstructions({
    payer: owner,
    owner: owner.address,
    collateralMint: mint,
    conditionId,
    outcomeCount: 2,
    partition,
  });
  assert.equal(setup.length, 6);

  const decoder = getSplitFromCollateralInstructionDataDecoder();
  assert.equal(
    decoder.decode((await getSplitRootCollateralInstruction(input)).data!).acceptIssuerControlled,
    false,
  );
  assert.equal(
    decoder.decode(
      (await getSplitRootCollateralInstruction({ ...input, acceptIssuerControlled: true })).data!,
    ).acceptIssuerControlled,
    true,
  );
});

test("rejects partial partitions and invalid amounts before building", async () => {
  const owner = await generateKeyPairSigner();
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(92), 3);
  const input = {
    owner,
    ownerTokenAccount,
    collateralMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    conditionId,
    outcomeCount: 3,
    partition,
    amount: 1n,
  };
  await assert.rejects(() => getSplitRootCollateralInstruction(input), /full partition/);
  await assert.rejects(
    () =>
      getSplitRootCollateralInstruction({
        ...input,
        outcomeCount: 2,
        amount: 0n,
      }),
    /amount/,
  );
});
