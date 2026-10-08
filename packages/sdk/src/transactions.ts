import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import {
  DEFAULT_V1_COMPUTE_UNIT_LIMIT,
  DEFAULT_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
} from "./transaction-capacity.ts";

export type CcTokenTransactionVersion = 0 | 1;

export type CcTokenBlockhashLifetime = Readonly<{
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
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
  lookupTables?: AddressesByLookupTableAddress;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
}) {
  if (input.version === 0) {
    let message = appendTransactionMessageInstructions(
      input.instructions,
      setTransactionMessageFeePayerSigner(input.feePayer, createTransactionMessage({ version: 0 })),
    );
    if (input.lookupTables && Object.keys(input.lookupTables).length > 0) {
      message = compressTransactionMessageUsingAddressLookupTables(message, input.lookupTables);
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
