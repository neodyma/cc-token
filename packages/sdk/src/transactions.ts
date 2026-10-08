import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type FetchAccountsConfig,
  type GetMultipleAccountsApi,
  type Instruction,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";

import {
  DEFAULT_V1_COMPUTE_UNIT_LIMIT,
  DEFAULT_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
} from "./transaction-capacity.ts";

export type CcTokenTransactionVersion = 0 | 1;

const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

export type CcTokenBlockhashLifetime = Readonly<{
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
}>;

export type AddressLookupTableSource = Readonly<{
  addresses: readonly Address[];
  rpc: Rpc<GetMultipleAccountsApi>;
  config?: FetchAccountsConfig;
}>;

export function selectTransactionVersion(
  supportedVersions: ReadonlySet<CcTokenTransactionVersion>,
  preferV1 = true,
): CcTokenTransactionVersion {
  if (preferV1 && supportedVersions.has(1)) return 1;
  if (supportedVersions.has(0)) return 0;
  throw new Error("wallet must support transaction version 0 or 1");
}

export async function buildCcTokenTransaction(input: {
  version: CcTokenTransactionVersion;
  feePayer: TransactionSigner;
  instructions: readonly Instruction[];
  lifetime: CcTokenBlockhashLifetime;
  lookupTables?: AddressLookupTableSource;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
}) {
  if (
    input.computeUnitLimit !== undefined &&
    (!Number.isInteger(input.computeUnitLimit) ||
      input.computeUnitLimit < 1 ||
      input.computeUnitLimit > MAX_COMPUTE_UNIT_LIMIT)
  ) {
    throw new RangeError("computeUnitLimit must be between 1 and 1,400,000");
  }
  if (input.version === 0) {
    const instructions =
      input.computeUnitLimit === undefined
        ? input.instructions
        : [
            getSetComputeUnitLimitInstruction({ units: input.computeUnitLimit }),
            ...input.instructions,
          ];
    let message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageFeePayerSigner(input.feePayer, createTransactionMessage({ version: 0 })),
    );
    if (input.lookupTables && input.lookupTables.addresses.length > 0) {
      const addresses = await fetchAddressesForLookupTables(
        [...input.lookupTables.addresses],
        input.lookupTables.rpc,
        input.lookupTables.config,
      );
      message = compressTransactionMessageUsingAddressLookupTables(message, addresses);
    }
    return signTransactionMessageWithSigners(
      setTransactionMessageLifetimeUsingBlockhash(input.lifetime, message),
    );
  }

  let message = appendTransactionMessageInstructions(
    input.instructions,
    setTransactionMessageFeePayerSigner(input.feePayer, createTransactionMessage({ version: 1 })),
  );
  message = setTransactionMessageComputeUnitLimit(
    input.computeUnitLimit ?? DEFAULT_V1_COMPUTE_UNIT_LIMIT,
    message,
  );
  message = setTransactionMessageLoadedAccountsDataSizeLimit(
    input.loadedAccountsDataSizeLimit ?? DEFAULT_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    message,
  );
  return signTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(input.lifetime, message),
  );
}
