import assert from "node:assert/strict";
import { test } from "node:test";

import { address, lamports, type Account } from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  ConditionStatus,
  DefinitionVerificationError,
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  getCollectionAddress,
  getConditionAddress,
  getPositionAddress,
  getPositionBalanceAddress,
  ROOT_COLLECTION_ID,
  verifyCollectionAccount,
  verifyConditionAccount,
  verifyPositionAccount,
  verifyPositionBalanceAccount,
  type CollectionDefinition,
  type Condition,
  type IndexSetWords,
  type PositionBalance,
  type PositionDefinition,
  type VerifiedCollateral,
  type VerifiedCollection,
} from "../src/index.ts";
import {
  getCollectionDefinitionDiscriminatorBytes,
  getConditionDiscriminatorBytes,
  getPositionBalanceDiscriminatorBytes,
  getPositionDefinitionDiscriminatorBytes,
} from "../src/generated/index.ts";

const resolver = address("11111111111111111111111111111111");

async function conditionAccount(
  outcomeCount = 4,
  payoutNumerators: bigint[] = Array<bigint>(outcomeCount).fill(0n),
): Promise<Account<Condition>> {
  const questionId = new Uint8Array(32).fill(outcomeCount);
  const conditionId = deriveConditionId(resolver, questionId, outcomeCount);
  const [conditionAddress, bump] = await getConditionAddress(conditionId);
  const payoutDenominator = payoutNumerators.reduce((sum, value) => sum + value, 0n);
  return {
    address: conditionAddress,
    data: {
      discriminator: getConditionDiscriminatorBytes(),
      version: 1,
      conditionId,
      resolver,
      questionId,
      outcomeCount,
      status: payoutDenominator === 0n ? ConditionStatus.Unresolved : ConditionStatus.Resolved,
      payoutNumerators,
      payoutDenominator,
      bump,
    },
    executable: false,
    lamports: lamports(1n),
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    space: 0n,
  };
}

async function collectionAccount(
  condition: Account<Condition>,
  parentCollectionId: Uint8Array,
  indexSet: IndexSetWords,
): Promise<Account<CollectionDefinition>> {
  const collectionId = deriveCollectionId(
    parentCollectionId,
    condition.data.conditionId,
    indexSet,
  ).collectionId;
  const [collectionAddress, bump] = await getCollectionAddress(collectionId);
  return {
    address: collectionAddress,
    data: {
      discriminator: getCollectionDefinitionDiscriminatorBytes(),
      version: 1,
      collectionId,
      parentCollectionId,
      conditionId: condition.data.conditionId,
      indexSet: { words: [...indexSet] },
      bump,
    },
    executable: false,
    lamports: lamports(1n),
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    space: 0n,
  };
}

test("verifies unresolved and resolved condition definitions", async () => {
  const unresolved = await conditionAccount();
  const resolved = await conditionAccount(4, [0n, 1n, 2n, 5n]);

  assert.equal(await verifyConditionAccount(unresolved), unresolved);
  assert.equal(await verifyConditionAccount(resolved), resolved);
});

test("rejects condition accounts with unauthenticated identity", async () => {
  const condition = await conditionAccount();
  const wrongOwner = {
    ...condition,
    programAddress: address("SysvarC1ock11111111111111111111111111111111"),
  };
  const wrongId = {
    ...condition,
    data: { ...condition.data, conditionId: new Uint8Array(32).fill(7) },
  };
  const wrongBump = {
    ...condition,
    data: { ...condition.data, bump: condition.data.bump ^ 1 },
  };

  await assert.rejects(() => verifyConditionAccount(wrongOwner), hasCode("invalid_owner"));
  await assert.rejects(() => verifyConditionAccount(wrongId), hasCode("invalid_identity"));
  await assert.rejects(() => verifyConditionAccount(wrongBump), hasCode("invalid_pda"));
});

test("rejects unsupported condition encodings", async () => {
  const condition = await conditionAccount();
  const wrongDiscriminator = {
    ...condition,
    data: { ...condition.data, discriminator: new Uint8Array(8) },
  };
  const wrongVersion = {
    ...condition,
    data: { ...condition.data, version: 2 },
  };

  await assert.rejects(
    () => verifyConditionAccount(wrongDiscriminator),
    hasCode("invalid_discriminator"),
  );
  await assert.rejects(() => verifyConditionAccount(wrongVersion), hasCode("invalid_version"));
});

test("rejects inconsistent condition payout state", async () => {
  const condition = await conditionAccount();
  const unresolvedWithPayout = {
    ...condition,
    data: {
      ...condition.data,
      payoutNumerators: [1n, 0n, 0n, 0n],
      payoutDenominator: 1n,
    },
  };
  const resolvedWithWrongDenominator = {
    ...condition,
    data: {
      ...condition.data,
      status: ConditionStatus.Resolved,
      payoutNumerators: [1n, 3n, 0n, 0n],
      payoutDenominator: 3n,
    },
  };

  await assert.rejects(
    () => verifyConditionAccount(unresolvedWithPayout),
    hasCode("invalid_payouts"),
  );
  await assert.rejects(
    () => verifyConditionAccount(resolvedWithWrongDenominator),
    hasCode("invalid_payouts"),
  );
});

test("verifies collection construction against its condition", async () => {
  const condition = await conditionAccount(8);
  const collection = await collectionAccount(condition, ROOT_COLLECTION_ID, [3n, 0n, 0n, 0n]);

  assert.equal(await verifyCollectionAccount(collection, condition), collection);
});

test("rejects malformed collection witnesses", async () => {
  const condition = await conditionAccount(8);
  const collection = await collectionAccount(condition, ROOT_COLLECTION_ID, [3n, 0n, 0n, 0n]);
  const wrongSubset = {
    ...collection,
    data: { ...collection.data, indexSet: { words: [0n, 0n, 0n, 0n] } },
  };
  const wrongCondition = await conditionAccount(4);

  await assert.rejects(
    () => verifyCollectionAccount(wrongSubset, condition),
    hasCode("invalid_witness"),
  );
  await assert.rejects(
    () => verifyCollectionAccount(collection, wrongCondition),
    hasCode("invalid_witness"),
  );
});

test("verifies position definitions and open zero balances", async () => {
  const owner = address("Vote111111111111111111111111111111111111111");
  const collateralMint = address("So11111111111111111111111111111111111111112");
  const condition = await conditionAccount(2);
  const collection = await collectionAccount(condition, ROOT_COLLECTION_ID, [1n, 0n, 0n, 0n]);
  const positionId = derivePositionId(collateralMint, collection.data.collectionId);
  const [positionAddress, positionBump] = await getPositionAddress(positionId);
  const position: Account<PositionDefinition> = {
    address: positionAddress,
    data: {
      discriminator: getPositionDefinitionDiscriminatorBytes(),
      version: 1,
      positionId,
      collateralMint,
      collectionId: collection.data.collectionId,
      bump: positionBump,
    },
    executable: false,
    lamports: lamports(1n),
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    space: 0n,
  };
  const collateral = {
    config: { data: { mint: collateralMint } },
  } as unknown as VerifiedCollateral;
  const verifiedCollection: VerifiedCollection = {
    collectionId: collection.data.collectionId,
    constructionPath: [{ collection, condition }],
    factors: [],
  };
  assert.equal(await verifyPositionAccount(position, collateral, verifiedCollection), position);

  const [balanceAddress, balanceBump] = await getPositionBalanceAddress(owner, positionId);
  const balance: Account<PositionBalance> = {
    address: balanceAddress,
    data: {
      discriminator: getPositionBalanceDiscriminatorBytes(),
      version: 1,
      owner,
      positionId,
      amount: 0n,
      bump: balanceBump,
    },
    executable: false,
    lamports: lamports(1n),
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    space: 0n,
  };
  assert.equal(await verifyPositionBalanceAccount(balance, owner, position), balance);
  await assert.rejects(
    () =>
      verifyPositionBalanceAccount(
        { ...balance, data: { ...balance.data, owner: resolver } },
        owner,
        position,
      ),
    hasCode("invalid_identity"),
  );
  await assert.rejects(
    () => verifyPositionAccount({ ...position, address: owner }, collateral, verifiedCollection),
    hasCode("invalid_pda"),
  );
});

function hasCode(code: DefinitionVerificationError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof DefinitionVerificationError && error.code === code;
}
