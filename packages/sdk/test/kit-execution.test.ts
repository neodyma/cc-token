import assert from "node:assert/strict";
import { test } from "node:test";

import {
  address,
  blockhash,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signature,
  type Base64EncodedWireTransaction,
  type Signature,
} from "@solana/kit";

import {
  createKitExecutionAdapter,
  executeConfirmedPlan,
  MemoryPlanCheckpointStore,
  type CcTokenExecutionRpc,
  type PreparedCcTokenTransaction,
  type TransactionInstructionPlanStep,
} from "../src/index.ts";

const programAddress = address("11111111111111111111111111111111");

test("Kit adapter builds, simulates, submits, confirms, and refetches a v0 step", async () => {
  const payer = await generateKeyPairSigner();
  const planId = "kit-plan";
  const step: TransactionInstructionPlanStep = {
    id: `${planId}:0`,
    planId,
    kind: "execute",
    instructions: [{ programAddress, data: new Uint8Array() }],
  };
  let submitted = false;
  let confirmedSignature = signature(
    "1111111111111111111111111111111111111111111111111111111111111111",
  );
  const rpc = {
    getLatestBlockhash() {
      return {
        async send() {
          return {
            context: { slot: 1n },
            value: {
              blockhash: blockhash("11111111111111111111111111111111"),
              lastValidBlockHeight: 100n,
            },
          };
        },
      };
    },
    simulateTransaction() {
      return {
        async send() {
          return { context: { slot: 1n }, value: { err: null, logs: ["simulated"] } };
        },
      };
    },
    sendTransaction(encoded: Base64EncodedWireTransaction) {
      return {
        async send() {
          submitted = true;
          const transaction = getTransactionDecoder().decode(
            Uint8Array.from(Buffer.from(encoded, "base64")),
          );
          confirmedSignature = getSignatureFromTransaction(transaction);
          return confirmedSignature;
        },
      };
    },
    getSignatureStatuses() {
      return {
        async send() {
          return {
            context: { slot: 2n },
            value: [
              {
                confirmationStatus: "confirmed",
                confirmations: 1n,
                err: null,
                slot: 2n,
                status: { Ok: null },
              },
            ],
          };
        },
      };
    },
    getBlockHeight() {
      return {
        async send() {
          return 2n;
        },
      };
    },
  } as unknown as CcTokenExecutionRpc;
  const store = new MemoryPlanCheckpointStore<PreparedCcTokenTransaction, Signature, bigint>();
  const adapter = createKitExecutionAdapter({
    rpc,
    feePayer: payer,
    checkpointStore: store,
    version: 0,
    async refetch() {
      return 9n;
    },
  });

  const receipts = await executeConfirmedPlan([step], adapter);
  assert.equal(submitted, true);
  assert.equal(receipts[0]?.signature, confirmedSignature);
  assert.equal(receipts[0]?.state, 9n);
  assert.equal((await store.load(planId, step.id))?.status, "refetched");
});

test("Kit adapter refuses a signature returned for a different transaction", async () => {
  const payer = await generateKeyPairSigner();
  const step: TransactionInstructionPlanStep = {
    id: "mismatch:0",
    planId: "mismatch",
    kind: "execute",
    instructions: [{ programAddress }],
  };
  const rpc = {
    getLatestBlockhash() {
      return {
        send: async () => ({
          context: { slot: 1n },
          value: {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: 100n,
          },
        }),
      };
    },
    simulateTransaction() {
      return {
        send: async () => ({ context: { slot: 1n }, value: { err: null, logs: null } }),
      };
    },
    sendTransaction() {
      return {
        send: async () =>
          signature("1111111111111111111111111111111111111111111111111111111111111111"),
      };
    },
  } as unknown as CcTokenExecutionRpc;
  const adapter = createKitExecutionAdapter({
    rpc,
    feePayer: payer,
    checkpointStore: new MemoryPlanCheckpointStore(),
    version: 0,
    async refetch() {},
  });

  await assert.rejects(
    () => executeConfirmedPlan([step], adapter),
    (error: unknown) =>
      error instanceof Error &&
      "phase" in error &&
      error.phase === "submission" &&
      error.cause instanceof Error &&
      /different transaction signature/.test(error.cause.message),
  );
});
