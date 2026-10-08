import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import {
  getMergePositionsInstruction as getGeneratedMergePositionsInstruction,
  getRegisterCollectionInstruction,
  getSplitPositionInstruction as getGeneratedSplitPositionInstruction,
} from "../generated/index.ts";
import {
  deriveCollectionId,
  derivePositionId,
  getCollectionAddress,
  getConditionAddress,
  getPositionAddress,
  getPositionBalanceAddress,
  ROOT_COLLECTION_ID,
  type IndexSetWords,
} from "../identity.ts";
import { validatePartition } from "../math.ts";
import {
  getInitializePositionBalanceInstruction,
  getRegisterPositionForCollectionInstruction,
} from "../definitions/positions.ts";

const MAX_U64 = 0xffff_ffff_ffff_ffffn;

export type NativePositionInput = Readonly<{
  owner: TransactionSigner;
  collateralMint: Address;
  parentCollectionId: ReadonlyUint8Array;
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  partition: readonly IndexSetWords[];
  amount: bigint;
}>;

export type NativePositionSetupInput = Readonly<{
  payer: TransactionSigner;
  owner: Address;
  collateralMint: Address;
  parentCollectionId: ReadonlyUint8Array;
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  partition: readonly IndexSetWords[];
}>;

export async function getSplitNativePositionInstruction(
  input: NativePositionInput,
): Promise<Instruction> {
  const resolved = await resolveNativePositionInput(input);
  const instruction = getGeneratedSplitPositionInstruction({
    owner: input.owner,
    condition: resolved.condition,
    sourcePosition: resolved.boundaryPosition,
    sourceBalance: resolved.boundaryBalance,
    parentCollection: resolved.parentCollection,
    args: resolved.args,
  });
  return withChildAccounts(instruction, resolved.childAccounts);
}

export async function getMergeNativePositionsInstruction(
  input: NativePositionInput,
): Promise<Instruction> {
  const resolved = await resolveNativePositionInput(input);
  const instruction = getGeneratedMergePositionsInstruction({
    owner: input.owner,
    condition: resolved.condition,
    destinationPosition: resolved.boundaryPosition,
    destinationBalance: resolved.boundaryBalance,
    parentCollection: resolved.parentCollection,
    args: resolved.args,
  });
  return withChildAccounts(instruction, resolved.childAccounts);
}

export async function getNativePositionSetupInstructions(
  input: NativePositionSetupInput,
): Promise<readonly Instruction[]> {
  const transition = resolveTransition(
    input.parentCollectionId,
    input.conditionId,
    input.outcomeCount,
    input.partition,
  );
  const [condition] = await getConditionAddress(input.conditionId);
  const parentCollection = transition.isRoot
    ? undefined
    : (await getCollectionAddress(input.parentCollectionId))[0];
  const instructions: Instruction[] = [];

  if (!transition.isFull) {
    instructions.push(
      ...(await getCollectionSetupInstructions({
        payer: input.payer,
        owner: input.owner,
        collateralMint: input.collateralMint,
        condition,
        parentCollection,
        parentCollectionId: input.parentCollectionId,
        conditionId: input.conditionId,
        indexSet: transition.union,
        collectionId: transition.boundaryCollectionId,
      })),
    );
  } else {
    instructions.push(
      await getRegisterPositionForCollectionInstruction({
        payer: input.payer,
        collateralMint: input.collateralMint,
        collectionId: transition.boundaryCollectionId,
      }),
      await getInitializePositionBalanceInstruction({
        payer: input.payer,
        owner: input.owner,
        positionId: derivePositionId(input.collateralMint, transition.boundaryCollectionId),
      }),
    );
  }

  for (let index = 0; index < input.partition.length; index += 1) {
    instructions.push(
      ...(await getCollectionSetupInstructions({
        payer: input.payer,
        owner: input.owner,
        collateralMint: input.collateralMint,
        condition,
        parentCollection,
        parentCollectionId: input.parentCollectionId,
        conditionId: input.conditionId,
        indexSet: input.partition[index]!,
        collectionId: transition.childCollectionIds[index]!,
      })),
    );
  }

  return instructions;
}

async function resolveNativePositionInput(input: NativePositionInput) {
  if (input.amount <= 0n || input.amount > MAX_U64) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
  const transition = resolveTransition(
    input.parentCollectionId,
    input.conditionId,
    input.outcomeCount,
    input.partition,
  );
  const boundaryPositionId = derivePositionId(
    input.collateralMint,
    transition.boundaryCollectionId,
  );
  const [[condition], [boundaryPosition], [boundaryBalance], parentCollection, childAccounts] =
    await Promise.all([
      getConditionAddress(input.conditionId),
      getPositionAddress(boundaryPositionId),
      getPositionBalanceAddress(input.owner.address, boundaryPositionId),
      transition.isRoot
        ? Promise.resolve(undefined)
        : getCollectionAddress(input.parentCollectionId).then(([address]) => address),
      Promise.all(
        transition.childCollectionIds.map(async (collectionId) => {
          const positionId = derivePositionId(input.collateralMint, collectionId);
          const [[position], [balance]] = await Promise.all([
            getPositionAddress(positionId),
            getPositionBalanceAddress(input.owner.address, positionId),
          ]);
          return [
            { address: position, role: AccountRole.READONLY },
            { address: balance, role: AccountRole.WRITABLE },
          ] as const;
        }),
      ),
    ]);

  return {
    condition,
    boundaryPosition,
    boundaryBalance,
    parentCollection,
    childAccounts: childAccounts.flat(),
    args: {
      parentCollectionId: input.parentCollectionId,
      conditionId: input.conditionId,
      partition: input.partition.map((words) => ({ words: [...words] })),
      amount: input.amount,
    },
  };
}

function resolveTransition(
  parentCollectionId: ReadonlyUint8Array,
  conditionId: ReadonlyUint8Array,
  outcomeCount: number,
  partition: readonly IndexSetWords[],
) {
  const validated = validatePartition(outcomeCount, partition);
  const isRoot = bytesEqual(parentCollectionId, ROOT_COLLECTION_ID);
  if (isRoot && validated.isFull) {
    throw new RangeError("root full-partition transitions require a collateral instruction");
  }
  const boundaryCollectionId = validated.isFull
    ? Uint8Array.from(parentCollectionId)
    : deriveCollectionId(parentCollectionId, conditionId, validated.union).collectionId;
  const childCollectionIds = partition.map(
    (indexSet) => deriveCollectionId(parentCollectionId, conditionId, indexSet).collectionId,
  );
  return {
    isRoot,
    isFull: validated.isFull,
    union: validated.union,
    boundaryCollectionId,
    childCollectionIds,
  };
}

async function getCollectionSetupInstructions(input: {
  payer: TransactionSigner;
  owner: Address;
  collateralMint: Address;
  condition: Address;
  parentCollection?: Address;
  parentCollectionId: ReadonlyUint8Array;
  conditionId: ReadonlyUint8Array;
  indexSet: IndexSetWords;
  collectionId: ReadonlyUint8Array;
}): Promise<readonly Instruction[]> {
  const positionId = derivePositionId(input.collateralMint, input.collectionId);
  const [collection] = await getCollectionAddress(input.collectionId);
  return [
    getRegisterCollectionInstruction({
      payer: input.payer,
      condition: input.condition,
      collection,
      parentCollection: input.parentCollection,
      collectionId: input.collectionId,
      parentCollectionId: input.parentCollectionId,
      conditionId: input.conditionId,
      indexSet: { words: [...input.indexSet] },
    }),
    await getRegisterPositionForCollectionInstruction({
      payer: input.payer,
      collateralMint: input.collateralMint,
      collectionId: input.collectionId,
    }),
    await getInitializePositionBalanceInstruction({
      payer: input.payer,
      owner: input.owner,
      positionId,
    }),
  ];
}

function withChildAccounts(
  instruction: Instruction,
  childAccounts: readonly AccountMeta[],
): Instruction {
  return Object.freeze({
    ...instruction,
    accounts: Object.freeze([...(instruction.accounts ?? []), ...childAccounts]),
  });
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
