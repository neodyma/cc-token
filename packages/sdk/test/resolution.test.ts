import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION,
  planPayoutReport,
  validatePayoutNumerators,
} from "../src/index.ts";

test("plans small reports directly for transaction v0", () => {
  const payoutNumerators = [0n, 1n, 2n, 5n];

  assert.deepEqual(planPayoutReport(payoutNumerators, 0), {
    kind: "direct",
    payoutNumerators,
  });
  assert.equal(validatePayoutNumerators(payoutNumerators), 8n);
});

test("plans every 256-entry report directly for transaction v1", () => {
  const payoutNumerators = Array<bigint>(256).fill((1n << 64n) - 1n);

  const plan = planPayoutReport(payoutNumerators, 1);

  assert.equal(plan.kind, "direct");
  assert.deepEqual(plan.payoutNumerators, payoutNumerators);
});

test("chunks a 256-entry report for transaction v0", () => {
  const payoutNumerators = Array<bigint>(256).fill(0n);
  payoutNumerators[255] = 1n;

  const plan = planPayoutReport(payoutNumerators, 0);

  assert.equal(plan.kind, "staged");
  if (plan.kind !== "staged") return;
  assert.deepEqual(
    plan.chunks.map((chunk) => chunk.length),
    [
      MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION,
      MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION,
      256 - 2 * MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION,
    ],
  );
  assert.deepEqual(plan.chunks.flat(), payoutNumerators);
});

test("rejects invalid payout reports before planning transactions", () => {
  assert.throws(() => planPayoutReport([1n], 0));
  assert.throws(() => planPayoutReport(Array<bigint>(257).fill(1n), 1));
  assert.throws(() => planPayoutReport([0n, 0n], 0));
  assert.throws(() => planPayoutReport([-1n, 1n], 0));
  assert.throws(() => planPayoutReport([1n << 64n, 1n], 0));
});
