import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Address,
  type Commitment,
  type GetBlockHeightApi,
  type GetLatestBlockhashApi,
  type GetMultipleAccountsApi,
  type GetSignatureStatusesApi,
  type Rpc,
  type SendTransactionApi,
  type Signature,
  type SimulateTransactionApi,
  type TransactionSigner,
} from "@solana/kit";

import type { PlanCheckpointStore } from "./checkpoint-stores.ts";
import type { ConfirmedPlanAdapter, ReconciliationStatus } from "./execution.ts";
import type { TransactionInstructionPlanStep } from "./operation-plans.ts";
import { buildCcTokenTransaction, type CcTokenTransactionVersion } from "./transactions.ts";

export type CcTokenExecutionRpc = Rpc<
  GetBlockHeightApi &
    GetLatestBlockhashApi &
    GetMultipleAccountsApi &
    GetSignatureStatusesApi &
    SendTransactionApi &
    SimulateTransactionApi
>;

export type CcTokenSignedTransaction = Awaited<ReturnType<typeof buildCcTokenTransaction>>;

export type PreparedCcTokenTransaction = Readonly<{
  transaction: CcTokenSignedTransaction;
  lastValidBlockHeight: bigint;
}>;

export type KitExecutionAdapterConfig<
  TStep extends TransactionInstructionPlanStep,
  TState,
> = Readonly<{
  rpc: CcTokenExecutionRpc;
  feePayer: TransactionSigner;
  checkpointStore: PlanCheckpointStore<PreparedCcTokenTransaction, Signature, TState>;
  refetch(step: TStep, signature: Signature): Promise<TState>;
  version: CcTokenTransactionVersion | ((step: TStep) => CcTokenTransactionVersion);
  lookupTableAddresses?: readonly Address[] | ((step: TStep) => readonly Address[]);
  commitment?: "confirmed" | "finalized";
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
  confirmationPollIntervalMs?: number;
  confirmationTimeoutMs?: number;
  abortSignal?: AbortSignal;
}>;

export function createKitExecutionAdapter<TStep extends TransactionInstructionPlanStep, TState>(
  config: KitExecutionAdapterConfig<TStep, TState>,
): ConfirmedPlanAdapter<TStep, PreparedCcTokenTransaction, Signature, TState> {
  const commitment = config.commitment ?? "confirmed";
  const confirmationPollIntervalMs = config.confirmationPollIntervalMs ?? 500;
  const confirmationTimeoutMs = config.confirmationTimeoutMs ?? 60_000;
  requirePositiveInteger(confirmationPollIntervalMs, "confirmationPollIntervalMs");
  requirePositiveInteger(confirmationTimeoutMs, "confirmationTimeoutMs");

  return {
    async loadCheckpoint(step) {
      const checkpoint = await config.checkpointStore.load(step.planId, step.id);
      if (checkpoint) requireMatchingSignature(checkpoint.transaction, checkpoint.signature);
      return checkpoint;
    },
    async getStatus(signature, step) {
      const checkpoint = await config.checkpointStore.load(step.planId, step.id);
      if (!checkpoint) return "unknown";
      requireMatchingSignature(checkpoint.transaction, checkpoint.signature);
      return getTransactionStatus(
        config.rpc,
        signature,
        checkpoint.transaction.lastValidBlockHeight,
        commitment,
        config.abortSignal,
      );
    },
    async buildTransaction(step) {
      const latestBlockhash = await config.rpc
        .getLatestBlockhash({ commitment })
        .send({ abortSignal: config.abortSignal });
      const version = typeof config.version === "function" ? config.version(step) : config.version;
      const lookupTableAddresses =
        typeof config.lookupTableAddresses === "function"
          ? config.lookupTableAddresses(step)
          : config.lookupTableAddresses;
      const transaction = await buildCcTokenTransaction({
        version,
        feePayer: config.feePayer,
        instructions: step.instructions,
        lifetime: latestBlockhash.value,
        lookupTables:
          version === 0 && lookupTableAddresses && lookupTableAddresses.length > 0
            ? { addresses: lookupTableAddresses, rpc: config.rpc }
            : undefined,
        computeUnitLimit: config.computeUnitLimit,
        loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit,
      });
      return {
        transaction,
        lastValidBlockHeight: latestBlockhash.value.lastValidBlockHeight,
      };
    },
    getSignature(prepared) {
      return getSignatureFromTransaction(prepared.transaction);
    },
    async simulate(prepared) {
      const simulation = await config.rpc
        .simulateTransaction(getBase64EncodedWireTransaction(prepared.transaction), {
          commitment,
          encoding: "base64",
          sigVerify: true,
        })
        .send({ abortSignal: config.abortSignal });
      return { err: simulation.value.err, logs: simulation.value.logs };
    },
    async recordCheckpoint(checkpoint) {
      await config.checkpointStore.record(checkpoint);
    },
    async submit(prepared) {
      const expectedSignature = getSignatureFromTransaction(prepared.transaction);
      const signature = await config.rpc
        .sendTransaction(getBase64EncodedWireTransaction(prepared.transaction), {
          encoding: "base64",
          preflightCommitment: commitment,
        })
        .send({ abortSignal: config.abortSignal });
      if (signature !== expectedSignature) {
        throw new Error("RPC returned a different transaction signature");
      }
    },
    async confirm(signature, step) {
      const checkpoint = await config.checkpointStore.load(step.planId, step.id);
      if (!checkpoint) throw new Error("execution checkpoint is missing during confirmation");
      const deadline = Date.now() + confirmationTimeoutMs;
      while (Date.now() < deadline) {
        const status = await getTransactionStatus(
          config.rpc,
          signature,
          checkpoint.transaction.lastValidBlockHeight,
          commitment,
          config.abortSignal,
        );
        if (status === "confirmed") return;
        if (status === "failed") throw new Error("transaction failed");
        if (status === "expired") throw new Error("transaction blockhash expired");
        await delay(confirmationPollIntervalMs, config.abortSignal);
      }
      throw new Error("transaction confirmation timed out");
    },
    refetch: config.refetch,
  };
}

async function getTransactionStatus(
  rpc: CcTokenExecutionRpc,
  signature: Signature,
  lastValidBlockHeight: bigint,
  commitment: "confirmed" | "finalized",
  abortSignal?: AbortSignal,
): Promise<ReconciliationStatus> {
  const response = await rpc
    .getSignatureStatuses([signature], { searchTransactionHistory: true })
    .send({ abortSignal });
  const status = response.value[0];
  if (status?.err) return "failed";
  if (status && reachesCommitment(status.confirmationStatus, commitment)) return "confirmed";
  const blockHeight = await rpc.getBlockHeight({ commitment }).send({ abortSignal });
  return blockHeight > lastValidBlockHeight ? "expired" : "unknown";
}

function reachesCommitment(
  actual: Commitment | null,
  required: "confirmed" | "finalized",
): boolean {
  if (actual === "finalized") return true;
  return actual === "confirmed" && required === "confirmed";
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function requireMatchingSignature(
  prepared: PreparedCcTokenTransaction,
  signature: Signature,
): void {
  if (getSignatureFromTransaction(prepared.transaction) !== signature) {
    throw new Error("checkpoint signature does not match its signed transaction");
  }
}

function delay(milliseconds: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) return Promise.reject(abortSignal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortSignal?.reason);
    };
    const timeout = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
