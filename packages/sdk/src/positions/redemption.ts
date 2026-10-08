import { findAssociatedTokenPda } from "@solana-program/token";
import {
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import { validateProperIndexSet } from "../composition/index-set.ts";
import {
  getRedeemPositionInstruction as getGeneratedRedeemPositionInstruction,
  getRedeemToCollateralInstructionAsync as getGeneratedRedeemToCollateralInstructionAsync,
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
import { getRegisterPositionForCollectionInstruction } from "../definitions/positions.ts";

const MAX_U64 = 0xffff_ffff_ffff_ffffn;

type RedemptionInput = Readonly<{
  owner: TransactionSigner;
  collateralMint: Address;
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  indexSet: IndexSetWords;
  amount: bigint;
}>;

export type RedeemNativePositionInput = RedemptionInput &
  Readonly<{
    parentCollectionId: ReadonlyUint8Array;
  }>;

export type RedeemRootCollateralInput = RedemptionInput &
  Readonly<{
    ownerTokenAccount: Address;
    tokenProgram: Address;
  }>;

export type RedeemNativePositionSetupInput = Readonly<{
  payer: TransactionSigner;
  collateralMint: Address;
  parentCollectionId: ReadonlyUint8Array;
}>;

export async function getRedeemNativePositionInstruction(
  input: RedeemNativePositionInput,
): Promise<Instruction> {
  validateRedemptionInput(input);
  if (bytesEqual(input.parentCollectionId, ROOT_COLLECTION_ID)) {
    throw new RangeError("root redemption requires the collateral instruction");
  }

  const sourceCollectionId = deriveCollectionId(
    input.parentCollectionId,
    input.conditionId,
    input.indexSet,
  ).collectionId;
  const sourcePositionId = derivePositionId(input.collateralMint, sourceCollectionId);
  const destinationPositionId = derivePositionId(input.collateralMint, input.parentCollectionId);
  const [
    [condition],
    [parentCollection],
    [sourcePosition],
    [sourceBalance],
    [destinationPosition],
    [destinationBalance],
  ] = await Promise.all([
    getConditionAddress(input.conditionId),
    getCollectionAddress(input.parentCollectionId),
    getPositionAddress(sourcePositionId),
    getPositionBalanceAddress(input.owner.address, sourcePositionId),
    getPositionAddress(destinationPositionId),
    getPositionBalanceAddress(input.owner.address, destinationPositionId),
  ]);

  return getGeneratedRedeemPositionInstruction({
    owner: input.owner,
    condition,
    parentCollection,
    sourcePosition,
    sourceBalance,
    destinationPosition,
    destinationBalance,
    args: redemptionArgs(input),
  });
}

export async function getRedeemRootCollateralInstruction(
  input: RedeemRootCollateralInput,
): Promise<Instruction> {
  validateRedemptionInput(input);
  const sourceCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    input.conditionId,
    input.indexSet,
  ).collectionId;
  const sourcePositionId = derivePositionId(input.collateralMint, sourceCollectionId);
  const [[condition], [sourcePosition], [sourceBalance], [vaultAuthority]] = await Promise.all([
    getConditionAddress(input.conditionId),
    getPositionAddress(sourcePositionId),
    getPositionBalanceAddress(input.owner.address, sourcePositionId),
    getVaultAuthorityAddress(input.collateralMint),
  ]);
  const [vault] = await findAssociatedTokenPda({
    owner: vaultAuthority,
    tokenProgram: input.tokenProgram,
    mint: input.collateralMint,
  });

  return getGeneratedRedeemToCollateralInstructionAsync({
    owner: input.owner,
    ownerDestination: input.ownerTokenAccount,
    mint: input.collateralMint,
    vault,
    condition,
    sourcePosition,
    sourceBalance,
    tokenProgram: input.tokenProgram,
    args: redemptionArgs(input),
  });
}

export async function getRedeemNativePositionSetupInstructions(
  input: RedeemNativePositionSetupInput,
): Promise<readonly Instruction[]> {
  if (bytesEqual(input.parentCollectionId, ROOT_COLLECTION_ID)) {
    throw new RangeError("root redemption does not create a residual position");
  }
  return [
    await getRegisterPositionForCollectionInstruction({
      payer: input.payer,
      collateralMint: input.collateralMint,
      collectionId: input.parentCollectionId,
    }),
  ];
}

function validateRedemptionInput(input: RedemptionInput): void {
  if (input.amount <= 0n || input.amount > MAX_U64) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
  validateProperIndexSet(input.outcomeCount, input.indexSet);
}

function redemptionArgs(input: RedemptionInput) {
  return {
    conditionId: input.conditionId,
    indexSet: { words: [...input.indexSet] },
    amount: input.amount,
  };
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
