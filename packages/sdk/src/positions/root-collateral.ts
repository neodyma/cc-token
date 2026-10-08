import { findAssociatedTokenPda } from "@solana-program/token";
import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import { validatePartition } from "../math.ts";
import {
  getMergeToCollateralInstructionAsync,
  getRegisterCollectionInstruction,
  getSplitFromCollateralInstructionAsync,
} from "../generated/index.ts";
import {
  deriveCollectionId,
  derivePositionId,
  getCollectionAddress,
  getConditionAddress,
  getPositionAddress,
  getPositionBalanceAddress,
  getVaultAuthorityAddress,
  ROOT_COLLECTION_ID,
  type IndexSetWords,
} from "../identity.ts";
import {
  getInitializePositionBalanceInstruction,
  getRegisterPositionForCollectionInstruction,
} from "../definitions/positions.ts";

export type RootCollateralInput = Readonly<{
  owner: TransactionSigner;
  ownerTokenAccount: Address;
  collateralMint: Address;
  tokenProgram: Address;
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  partition: readonly IndexSetWords[];
  amount: bigint;
}>;

export type RootCollateralSetupInput = Readonly<{
  payer: TransactionSigner;
  owner: Address;
  collateralMint: Address;
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  partition: readonly IndexSetWords[];
}>;

export async function getSplitRootCollateralInstruction(
  input: RootCollateralInput,
): Promise<Instruction> {
  const resolved = await resolveRootCollateralInput(input);
  const instruction = await getSplitFromCollateralInstructionAsync({
    owner: input.owner,
    ownerSource: input.ownerTokenAccount,
    mint: input.collateralMint,
    vault: resolved.vault,
    condition: resolved.condition,
    tokenProgram: input.tokenProgram,
    args: resolved.args,
  });
  return withPositionAccounts(instruction, resolved.positionAccounts);
}

export async function getMergeRootCollateralInstruction(
  input: RootCollateralInput,
): Promise<Instruction> {
  const resolved = await resolveRootCollateralInput(input);
  const instruction = await getMergeToCollateralInstructionAsync({
    owner: input.owner,
    ownerDestination: input.ownerTokenAccount,
    mint: input.collateralMint,
    vault: resolved.vault,
    condition: resolved.condition,
    tokenProgram: input.tokenProgram,
    args: resolved.args,
  });
  return withPositionAccounts(instruction, resolved.positionAccounts);
}

export async function getRootCollateralSetupInstructions(
  input: RootCollateralSetupInput,
): Promise<readonly Instruction[]> {
  validateFullPartition(input.outcomeCount, input.partition);
  const [condition] = await getConditionAddress(input.conditionId);
  const instructions: Instruction[] = [];

  for (const indexSet of input.partition) {
    const collectionId = deriveCollectionId(
      ROOT_COLLECTION_ID,
      input.conditionId,
      indexSet,
    ).collectionId;
    const positionId = derivePositionId(input.collateralMint, collectionId);
    const [collection] = await getCollectionAddress(collectionId);
    instructions.push(
      getRegisterCollectionInstruction({
        payer: input.payer,
        condition,
        collection,
        collectionId,
        parentCollectionId: ROOT_COLLECTION_ID,
        conditionId: input.conditionId,
        indexSet: { words: [...indexSet] },
      }),
      await getRegisterPositionForCollectionInstruction({
        payer: input.payer,
        collateralMint: input.collateralMint,
        collectionId,
      }),
      await getInitializePositionBalanceInstruction({
        payer: input.payer,
        owner: input.owner,
        positionId,
      }),
    );
  }
  return instructions;
}

async function resolveRootCollateralInput(input: RootCollateralInput) {
  if (input.amount <= 0n || input.amount > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
  validateFullPartition(input.outcomeCount, input.partition);
  const [[condition], [vaultAuthority]] = await Promise.all([
    getConditionAddress(input.conditionId),
    getVaultAuthorityAddress(input.collateralMint),
  ]);
  const [vault] = await findAssociatedTokenPda({
    owner: vaultAuthority,
    tokenProgram: input.tokenProgram,
    mint: input.collateralMint,
  });
  const positionAccounts = await Promise.all(
    input.partition.map(async (indexSet) => {
      const collectionId = deriveCollectionId(
        ROOT_COLLECTION_ID,
        input.conditionId,
        indexSet,
      ).collectionId;
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
  );
  return {
    condition,
    vault,
    positionAccounts: positionAccounts.flat(),
    args: {
      conditionId: input.conditionId,
      partition: input.partition.map((words) => ({ words: [...words] })),
      amount: input.amount,
    },
  };
}

function validateFullPartition(outcomeCount: number, partition: readonly IndexSetWords[]): void {
  if (!validatePartition(outcomeCount, partition).isFull) {
    throw new RangeError("root collateral operations require a full partition");
  }
}

function withPositionAccounts(
  instruction: Instruction,
  positionAccounts: readonly AccountMeta[],
): Instruction {
  return Object.freeze({
    ...instruction,
    accounts: Object.freeze([...(instruction.accounts ?? []), ...positionAccounts]),
  });
}
