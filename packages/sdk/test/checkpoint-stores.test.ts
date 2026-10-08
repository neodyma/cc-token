import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemoryPlanCheckpointStore,
  WebStoragePlanCheckpointStore,
  type ExecutionCheckpoint,
  type WebStorage,
} from "../src/index.ts";

type StoredTransaction = Readonly<{
  messageBytes: Uint8Array;
  lastValidBlockHeight: bigint;
}>;

const checkpoint: ExecutionCheckpoint<StoredTransaction, string, { amount: bigint }> = {
  planId: "plan:alpha",
  stepId: "plan:alpha:0",
  transaction: {
    messageBytes: Uint8Array.of(1, 2, 3),
    lastValidBlockHeight: 42n,
  },
  signature: "signature",
  status: "refetched",
  state: { amount: 7n },
};

test("memory checkpoint store scopes records by plan and step", async () => {
  const store = new MemoryPlanCheckpointStore<StoredTransaction, string, { amount: bigint }>();
  await store.record(checkpoint);

  assert.equal(await store.load("different", checkpoint.stepId), undefined);
  assert.deepEqual(await store.load(checkpoint.planId, checkpoint.stepId), checkpoint);
  await store.remove(checkpoint.planId, checkpoint.stepId);
  assert.equal(await store.load(checkpoint.planId, checkpoint.stepId), undefined);
});

test("web storage checkpoint store preserves bytes and bigint values", async () => {
  const values = new Map<string, string>();
  const storage: WebStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const store = new WebStoragePlanCheckpointStore<StoredTransaction, string, { amount: bigint }>(
    storage,
  );

  await store.record(checkpoint);
  const restored = await store.load(checkpoint.planId, checkpoint.stepId);
  assert.deepEqual(restored, checkpoint);
  assert(restored?.transaction.messageBytes instanceof Uint8Array);
  assert.equal(typeof restored?.transaction.lastValidBlockHeight, "bigint");

  await store.remove(checkpoint.planId, checkpoint.stepId);
  assert.equal(await store.load(checkpoint.planId, checkpoint.stepId), undefined);
});

test("web storage checkpoint store rejects malformed records", async () => {
  const storage: WebStorage = {
    getItem() {
      return '{"planId":"plan"}';
    },
    setItem() {},
    removeItem() {},
  };
  const store = new WebStoragePlanCheckpointStore(storage);
  await assert.rejects(() => store.load("plan", "step"), /invalid execution checkpoint/);
});
