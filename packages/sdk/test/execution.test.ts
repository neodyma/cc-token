import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executeConfirmedPlan,
  PlanExecutionError,
  reconcileExecutionCheckpoint,
  type ExecutionCheckpoint,
} from "../src/index.ts";

const planId = "test-plan:0123456789abcdef";
const steps = [
  { id: `${planId}:setup`, planId },
  { id: `${planId}:execute`, planId },
] as const;
const freshExecutionState = {
  async loadCheckpoint() {
    return undefined;
  },
  async getStatus() {
    return "unknown" as const;
  },
};

test("checkpoints signed transactions before submission and records every phase", async () => {
  const calls: string[] = [];
  const receipts = await executeConfirmedPlan(steps, {
    ...freshExecutionState,
    async buildTransaction(step) {
      calls.push(`build:${step.id}`);
      return `transaction:${step.id}`;
    },
    getSignature(_transaction, step) {
      calls.push(`signature:${step.id}`);
      return `signature:${step.id}`;
    },
    async simulate(_transaction, step) {
      calls.push(`simulate:${step.id}`);
      return { err: null };
    },
    async recordCheckpoint(checkpoint) {
      calls.push(`checkpoint:${checkpoint.status}:${checkpoint.stepId}`);
    },
    async submit(_transaction, step) {
      calls.push(`submit:${step.id}`);
    },
    async confirm(_signature, step) {
      calls.push(`confirm:${step.id}`);
    },
    async refetch(step) {
      calls.push(`refetch:${step.id}`);
      return `state:${step.id}`;
    },
  });

  assert.deepEqual(calls.slice(0, 6), [
    `build:${steps[0].id}`,
    `signature:${steps[0].id}`,
    `simulate:${steps[0].id}`,
    `checkpoint:prepared:${steps[0].id}`,
    `submit:${steps[0].id}`,
    `checkpoint:submitted:${steps[0].id}`,
  ]);
  assert.deepEqual(
    receipts.map(({ planId: receiptPlanId, stepId, signature, state }) => ({
      planId: receiptPlanId,
      stepId,
      signature,
      state,
    })),
    steps.map((step) => ({
      planId,
      stepId: step.id,
      signature: `signature:${step.id}`,
      state: `state:${step.id}`,
    })),
  );
});

test("never checkpoints or submits a failed simulation", async () => {
  const submitted: string[] = [];
  const checkpoints: string[] = [];
  await assert.rejects(
    () =>
      executeConfirmedPlan(steps, {
        ...freshExecutionState,
        async buildTransaction(step) {
          return step.id;
        },
        getSignature(_transaction, step) {
          return `signature:${step.id}`;
        },
        async simulate(_transaction, step) {
          return step.id === steps[1].id
            ? { err: "insufficient balance", logs: ["program log"] }
            : { err: null };
        },
        async recordCheckpoint(checkpoint) {
          checkpoints.push(`${checkpoint.stepId}:${checkpoint.status}`);
        },
        async submit(_transaction, step) {
          submitted.push(step.id);
        },
        async confirm() {},
        async refetch(step) {
          return step.id;
        },
      }),
    (error) => {
      assert(error instanceof PlanExecutionError);
      assert.equal(error.phase, "simulation");
      assert.equal(error.stepId, steps[1].id);
      assert.deepEqual(error.logs, ["program log"]);
      assert.deepEqual(
        error.completed.map((receipt) => receipt.stepId),
        [steps[0].id],
      );
      return true;
    },
  );
  assert.deepEqual(submitted, [steps[0].id]);
  assert.equal(
    checkpoints.some((checkpoint) => checkpoint.startsWith(steps[1].id)),
    false,
  );
});

test("submission ambiguity retains the prepared transaction and signature", async () => {
  const recorded: ExecutionCheckpoint<string, string, string>[] = [];
  await assert.rejects(
    () =>
      executeConfirmedPlan([steps[0]], {
        ...freshExecutionState,
        async buildTransaction() {
          return "signed-transaction";
        },
        getSignature() {
          return "known-signature";
        },
        async simulate() {
          return { err: null };
        },
        async recordCheckpoint(checkpoint) {
          recorded.push(checkpoint);
        },
        async submit() {
          throw new Error("RPC response lost");
        },
        async confirm() {},
        async refetch() {
          return "state";
        },
      }),
    (error) => {
      assert(error instanceof PlanExecutionError);
      assert.equal(error.phase, "submission");
      assert.equal(error.checkpoint?.status, "prepared");
      assert.equal(error.checkpoint?.signature, "known-signature");
      assert.equal(error.checkpoint?.transaction, "signed-transaction");
      return true;
    },
  );
  assert.deepEqual(
    recorded.map((checkpoint) => checkpoint.status),
    ["prepared"],
  );
});

test("reconciles a stored checkpoint before rebuilding", async () => {
  let checkpoint: ExecutionCheckpoint<string, string, string> | undefined = {
    planId,
    stepId: steps[0].id,
    transaction: "original-transaction",
    signature: "original-signature",
    status: "prepared",
  };
  let status: "unknown" | "expired" = "unknown";
  let buildCount = 0;
  const adapter = {
    async loadCheckpoint() {
      return checkpoint;
    },
    async getStatus() {
      return status;
    },
    async buildTransaction() {
      buildCount += 1;
      return "replacement-transaction";
    },
    getSignature() {
      return "replacement-signature";
    },
    async simulate() {
      return { err: null };
    },
    async recordCheckpoint(value: ExecutionCheckpoint<string, string, string>) {
      checkpoint = value;
    },
    async submit() {},
    async confirm() {},
    async refetch() {
      return "current-state";
    },
  };

  await assert.rejects(
    () => executeConfirmedPlan([steps[0]], adapter),
    (error) => error instanceof PlanExecutionError && error.phase === "reconciliation",
  );
  assert.equal(buildCount, 0);

  status = "expired";
  const receipts = await executeConfirmedPlan([steps[0]], adapter);
  assert.equal(buildCount, 1);
  assert.equal(receipts[0]?.signature, "replacement-signature");
});

test("does not submit when the prepared checkpoint cannot be persisted", async () => {
  let submitted = false;
  await assert.rejects(
    () =>
      executeConfirmedPlan([steps[0]], {
        ...freshExecutionState,
        async buildTransaction() {
          return "signed-transaction";
        },
        getSignature() {
          return "known-signature";
        },
        async simulate() {
          return { err: null };
        },
        async recordCheckpoint() {
          throw new Error("storage unavailable");
        },
        async submit() {
          submitted = true;
        },
        async confirm() {},
        async refetch() {
          return "state";
        },
      }),
    (error) => error instanceof PlanExecutionError && error.phase === "checkpoint",
  );
  assert.equal(submitted, false);
});

test("refetch failure retains a confirmed checkpoint", async () => {
  await assert.rejects(
    () =>
      executeConfirmedPlan([steps[0]], {
        ...freshExecutionState,
        async buildTransaction() {
          return "transaction";
        },
        getSignature() {
          return "confirmed-signature";
        },
        async simulate() {
          return { err: null };
        },
        async recordCheckpoint() {},
        async submit() {},
        async confirm() {},
        async refetch() {
          throw new Error("RPC unavailable");
        },
      }),
    (error) =>
      error instanceof PlanExecutionError &&
      error.phase === "refetch" &&
      error.checkpoint?.status === "confirmed" &&
      error.checkpoint.signature === "confirmed-signature",
  );
});

test("reconciles ambiguous checkpoints before allowing a retry", async () => {
  const checkpoint: ExecutionCheckpoint<string, string, string> = {
    planId,
    stepId: steps[0].id,
    transaction: "signed-transaction",
    signature: "known-signature",
    status: "prepared",
  };
  const recorded: string[] = [];
  const confirmed = await reconcileExecutionCheckpoint(steps[0], checkpoint, {
    async getStatus() {
      return "confirmed";
    },
    async refetch() {
      return "current-state";
    },
    async recordCheckpoint(value) {
      recorded.push(value.status);
    },
  });
  assert.deepEqual(confirmed, {
    status: "complete",
    receipt: {
      planId,
      stepId: steps[0].id,
      signature: "known-signature",
      state: "current-state",
    },
  });
  assert.deepEqual(recorded, ["confirmed", "refetched"]);

  const pending = await reconcileExecutionCheckpoint(steps[0], checkpoint, {
    async getStatus() {
      return "unknown";
    },
    async refetch() {
      throw new Error("must not refetch");
    },
    async recordCheckpoint() {},
  });
  assert.deepEqual(pending, { status: "pending" });

  const retryable = await reconcileExecutionCheckpoint(steps[0], checkpoint, {
    async getStatus() {
      return "expired";
    },
    async refetch() {
      throw new Error("must not refetch");
    },
    async recordCheckpoint() {},
  });
  assert.deepEqual(retryable, { status: "retryable" });

  await assert.rejects(
    () =>
      reconcileExecutionCheckpoint({ ...steps[0], planId: "different-plan" }, checkpoint, {
        async getStatus() {
          return "unknown";
        },
        async refetch() {
          return "state";
        },
        async recordCheckpoint() {},
      }),
    /does not belong/,
  );
});
