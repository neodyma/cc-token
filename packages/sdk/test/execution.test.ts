import assert from "node:assert/strict";
import { test } from "node:test";

import { executeConfirmedPlan, PlanExecutionError } from "../src/index.ts";

const steps = [{ id: "setup" }, { id: "execute" }] as const;

test("simulates, submits, confirms and refetches every plan step in order", async () => {
  const calls: string[] = [];
  const receipts = await executeConfirmedPlan(steps, {
    async buildTransaction(step) {
      calls.push(`build:${step.id}`);
      return `transaction:${step.id}`;
    },
    async simulate(_transaction, step) {
      calls.push(`simulate:${step.id}`);
      return { err: null };
    },
    async submit(_transaction, step) {
      calls.push(`submit:${step.id}`);
      return `signature:${step.id}`;
    },
    async confirm(_signature, step) {
      calls.push(`confirm:${step.id}`);
    },
    async refetch(step) {
      calls.push(`refetch:${step.id}`);
      return `state:${step.id}`;
    },
  });

  assert.deepEqual(
    calls,
    steps.flatMap((step) =>
      ["build", "simulate", "submit", "confirm", "refetch"].map((phase) => `${phase}:${step.id}`),
    ),
  );
  assert.deepEqual(receipts, [
    { stepId: "setup", signature: "signature:setup", state: "state:setup" },
    { stepId: "execute", signature: "signature:execute", state: "state:execute" },
  ]);
});

test("never submits a failed simulation and retains completed receipts", async () => {
  const submitted: string[] = [];
  await assert.rejects(
    () =>
      executeConfirmedPlan(steps, {
        async buildTransaction(step) {
          return step.id;
        },
        async simulate(_transaction, step) {
          return step.id === "execute"
            ? { err: "insufficient balance", logs: ["program log"] }
            : { err: null };
        },
        async submit(_transaction, step) {
          submitted.push(step.id);
          return step.id;
        },
        async confirm() {},
        async refetch(step) {
          return step.id;
        },
      }),
    (error) => {
      assert(error instanceof PlanExecutionError);
      assert.equal(error.phase, "simulation");
      assert.equal(error.stepId, "execute");
      assert.deepEqual(error.logs, ["program log"]);
      assert.deepEqual(
        error.completed.map((receipt) => receipt.stepId),
        ["setup"],
      );
      return true;
    },
  );
  assert.deepEqual(submitted, ["setup"]);
});

test("reports confirmed transactions separately from refetch failures", async () => {
  await assert.rejects(
    () =>
      executeConfirmedPlan([steps[0]], {
        async buildTransaction() {
          return "transaction";
        },
        async simulate() {
          return { err: null };
        },
        async submit() {
          return "confirmed-signature";
        },
        async confirm() {},
        async refetch() {
          throw new Error("RPC unavailable");
        },
      }),
    (error) =>
      error instanceof PlanExecutionError &&
      error.phase === "refetch" &&
      error.signature === "confirmed-signature",
  );
});
