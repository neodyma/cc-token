import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import {
  getBatchTransferPositionsInstruction as getGeneratedBatchTransferPositionsInstruction,
  getTransferPositionInstruction as getGeneratedTransferPositionInstruction,
} from "../generated/index.ts";
import { getPositionAddress, getPositionBalanceAddress } from "../identity.ts";
import { getInitializePositionBalanceInstruction } from "../definitions/positions.ts";

const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const MAX_BATCH_TRANSFERS = 16;

export type TransferNativePositionInput = Readonly<{
  owner: TransactionSigner;
  recipient: Address;
  positionId: ReadonlyUint8Array;
  amount: bigint;
}>;

export type NativePositionTransfer = Readonly<{
  positionId: ReadonlyUint8Array;
  amount: bigint;
}>;

export type BatchTransferNativePositionsInput = Readonly<{
  owner: TransactionSigner;
  recipient: Address;
  transfers: readonly NativePositionTransfer[];
}>;

export type BatchTransferSetupInput = Readonly<{
  payer: TransactionSigner;
  recipient: Address;
  transfers: readonly NativePositionTransfer[];
}>;

export async function getTransferNativePositionInstruction(
  input: TransferNativePositionInput,
): Promise<Instruction> {
  validateDistinctOwners(input.owner.address, input.recipient);
  validateAmount(input.amount);
  const [[position], [sourceBalance], [destinationBalance]] = await Promise.all([
    getPositionAddress(input.positionId),
    getPositionBalanceAddress(input.owner.address, input.positionId),
    getPositionBalanceAddress(input.recipient, input.positionId),
  ]);
  return withTransferAccounts(
    getGeneratedTransferPositionInstruction({
      owner: input.owner,
      recipient: input.recipient,
      position,
      sourceBalance,
      amount: input.amount,
    }),
    [{ address: destinationBalance, role: AccountRole.WRITABLE }],
  );
}

export async function getBatchTransferNativePositionsInstruction(
  input: BatchTransferNativePositionsInput,
): Promise<Instruction> {
  validateDistinctOwners(input.owner.address, input.recipient);
  const transfers = normalizeBatchTransfers(input.transfers);
  const transferAccounts = await Promise.all(
    transfers.map(async ({ positionId }) => {
      const [[position], [sourceBalance], [destinationBalance]] = await Promise.all([
        getPositionAddress(positionId),
        getPositionBalanceAddress(input.owner.address, positionId),
        getPositionBalanceAddress(input.recipient, positionId),
      ]);
      return [
        { address: position, role: AccountRole.READONLY },
        { address: sourceBalance, role: AccountRole.WRITABLE },
        { address: destinationBalance, role: AccountRole.WRITABLE },
      ] as const;
    }),
  );
  return withTransferAccounts(
    getGeneratedBatchTransferPositionsInstruction({
      owner: input.owner,
      recipient: input.recipient,
      amounts: transfers.map(({ amount }) => amount),
    }),
    transferAccounts.flat(),
  );
}

export async function getBatchTransferSetupInstructions(
  input: BatchTransferSetupInput,
): Promise<readonly Instruction[]> {
  const transfers = normalizeBatchTransfers(input.transfers);
  return Promise.all(
    transfers.map(({ positionId }) =>
      getInitializePositionBalanceInstruction({
        payer: input.payer,
        owner: input.recipient,
        positionId,
      }),
    ),
  );
}

export function normalizeBatchTransfers(
  inputs: readonly NativePositionTransfer[],
): readonly NativePositionTransfer[] {
  if (inputs.length === 0) throw new RangeError("a transfer batch must not be empty");
  const transfers = new Map<string, { positionId: Uint8Array; amount: bigint }>();

  for (const input of inputs) {
    validatePositionId(input.positionId);
    validateAmount(input.amount);
    const key = bytesKey(input.positionId);
    const existing = transfers.get(key);
    if (!existing) {
      transfers.set(key, {
        positionId: Uint8Array.from(input.positionId),
        amount: input.amount,
      });
      continue;
    }
    const amount = existing.amount + input.amount;
    if (amount > MAX_U64) throw new RangeError("consolidated transfer amount exceeds u64::MAX");
    existing.amount = amount;
  }

  if (transfers.size > MAX_BATCH_TRANSFERS) {
    throw new RangeError(`a transfer batch may contain at most ${MAX_BATCH_TRANSFERS} positions`);
  }
  return [...transfers.values()];
}

function withTransferAccounts(
  instruction: Instruction,
  transferAccounts: readonly AccountMeta[],
): Instruction {
  return Object.freeze({
    ...instruction,
    accounts: Object.freeze([...(instruction.accounts ?? []), ...transferAccounts]),
  });
}

function validateAmount(amount: bigint): void {
  if (amount <= 0n || amount > MAX_U64) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
}

function validatePositionId(positionId: ReadonlyUint8Array): void {
  if (positionId.length !== 32) throw new RangeError("positionId must contain 32 bytes");
}

function validateDistinctOwners(owner: Address, recipient: Address): void {
  if (owner === recipient) throw new RangeError("source and destination owners must differ");
}

function bytesKey(bytes: ReadonlyUint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
