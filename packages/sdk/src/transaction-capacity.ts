import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "@solana/kit";

import type { CcTokenTransactionVersion } from "./transactions.ts";

export const DEFAULT_V1_COMPUTE_UNIT_LIMIT = 1_400_000;
export const DEFAULT_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export type TransactionCapacityEstimate = Readonly<{
  version: CcTokenTransactionVersion;
  size: number;
  sizeLimit: number;
  fits: boolean;
  instructionCount: number;
  instructionDataBytes: number;
  uniqueAccountCount: number;
  signerCount: number;
  writableAccountCount: number;
  lookupTableCount: number;
}>;

export type TransactionCapacityInput = Readonly<{
  version: CcTokenTransactionVersion;
  feePayer: Address;
  instructions: readonly Instruction[];
  lookupTables?: AddressesByLookupTableAddress;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
}>;

export type PlannedTransaction = Readonly<{
  version: CcTokenTransactionVersion;
  estimate: TransactionCapacityEstimate;
}>;

export class TransactionCapacityError extends Error {
  readonly estimates: readonly TransactionCapacityEstimate[];

  constructor(estimates: readonly TransactionCapacityEstimate[]) {
    super("transaction does not fit any supported message version");
    this.name = "TransactionCapacityError";
    this.estimates = estimates;
  }
}

export function estimateTransactionCapacity(
  input: TransactionCapacityInput,
): TransactionCapacityEstimate {
  const message = buildSizedMessage(input);
  const size = getTransactionMessageSize(message);
  const sizeLimit = getTransactionMessageSizeLimit(message);
  const accountStats = getAccountStats(input.feePayer, input.instructions);
  return {
    version: input.version,
    size,
    sizeLimit,
    fits: size <= sizeLimit,
    instructionCount: input.instructions.length,
    instructionDataBytes: input.instructions.reduce(
      (length, instruction) => length + (instruction.data?.length ?? 0),
      0,
    ),
    uniqueAccountCount: accountStats.uniqueAccountCount,
    signerCount: accountStats.signerCount,
    writableAccountCount: accountStats.writableAccountCount,
    lookupTableCount: input.lookupTables ? Object.keys(input.lookupTables).length : 0,
  };
}

export function planTransactionVersion(input: {
  supportedVersions: ReadonlySet<CcTokenTransactionVersion>;
  feePayer: Address;
  instructions: readonly Instruction[];
  v0LookupTables?: AddressesByLookupTableAddress;
  preferV1?: boolean;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
}): PlannedTransaction {
  const estimates: TransactionCapacityEstimate[] = [];
  const estimate = (version: CcTokenTransactionVersion) => {
    const result = estimateTransactionCapacity({
      version,
      feePayer: input.feePayer,
      instructions: input.instructions,
      lookupTables: version === 0 ? input.v0LookupTables : undefined,
      computeUnitLimit: input.computeUnitLimit,
      loadedAccountsDataSizeLimit: input.loadedAccountsDataSizeLimit,
    });
    estimates.push(result);
    return result;
  };

  if (input.preferV1 && input.supportedVersions.has(1)) {
    const v1 = estimate(1);
    if (v1.fits) return { version: 1, estimate: v1 };
  }
  if (input.supportedVersions.has(0)) {
    const v0 = estimate(0);
    if (v0.fits) return { version: 0, estimate: v0 };
  }
  if (!input.preferV1 && input.supportedVersions.has(1)) {
    const v1 = estimate(1);
    if (v1.fits) return { version: 1, estimate: v1 };
  }
  if (estimates.length === 0) {
    throw new Error("wallet must support transaction version 0 or 1");
  }
  throw new TransactionCapacityError(estimates);
}

function buildSizedMessage(input: TransactionCapacityInput) {
  if (input.version === 0) {
    let message = appendTransactionMessageInstructions(
      input.instructions,
      setTransactionMessageFeePayer(input.feePayer, createTransactionMessage({ version: 0 })),
    );
    if (input.lookupTables && Object.keys(input.lookupTables).length > 0) {
      message = compressTransactionMessageUsingAddressLookupTables(message, input.lookupTables);
    }
    return message;
  }

  let message = appendTransactionMessageInstructions(
    input.instructions,
    setTransactionMessageFeePayer(input.feePayer, createTransactionMessage({ version: 1 })),
  );
  message = setTransactionMessageComputeUnitLimit(
    input.computeUnitLimit ?? DEFAULT_V1_COMPUTE_UNIT_LIMIT,
    message,
  );
  return setTransactionMessageLoadedAccountsDataSizeLimit(
    input.loadedAccountsDataSizeLimit ?? DEFAULT_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    message,
  );
}

function getAccountStats(feePayer: Address, instructions: readonly Instruction[]) {
  const accounts = new Map<Address, { signer: boolean; writable: boolean }>();
  accounts.set(feePayer, { signer: true, writable: true });
  for (const instruction of instructions) {
    const program = accounts.get(instruction.programAddress);
    accounts.set(instruction.programAddress, {
      signer: program?.signer ?? false,
      writable: program?.writable ?? false,
    });
    for (const account of instruction.accounts ?? []) {
      const previous = accounts.get(account.address);
      accounts.set(account.address, {
        signer: (previous?.signer ?? false) || account.role >= 2,
        writable: (previous?.writable ?? false) || account.role === 1 || account.role === 3,
      });
    }
  }
  return {
    uniqueAccountCount: accounts.size,
    signerCount: [...accounts.values()].filter((account) => account.signer).length,
    writableAccountCount: [...accounts.values()].filter((account) => account.writable).length,
  };
}
