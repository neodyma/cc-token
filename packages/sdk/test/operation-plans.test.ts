import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address, generateKeyPairSigner } from "@solana/kit";

import {
  flattenInstructionPlan,
  getBatchTransferInstructionPlan,
  getCompleteRefinementInstructionPlan,
  getPendingPlanSteps,
  planCompleteRefinement,
  planNativeTransferBatches,
  validatePartition,
  type IndexSetWords,
} from "../src/index.ts";

const mint = address("So11111111111111111111111111111111111111112");
const tokenAccount = address("SysvarRent111111111111111111111111111111111");
const recipient = address("Vote111111111111111111111111111111111111111");

test("plans a large refinement as complete remainder transitions", () => {
  const targetPartition = Array.from({ length: 40 }, (_, outcome) => singleton(outcome));
  const plan = planCompleteRefinement({ outcomeCount: 40, targetPartition });

  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.partition.length]),
    [
      ["root", 16],
      ["native", 16],
      ["native", 10],
    ],
  );
  assert.equal(validatePartition(40, plan.steps[0]!.partition).isFull, true);
  for (const step of plan.steps.slice(1)) {
    assert.deepEqual(validatePartition(40, step.partition).union, step.sourceIndexSet);
  }
  assert.deepEqual(plan.steps[0]!.sourceIndexSet, [(1n << 40n) - 1n, 0n, 0n, 0n]);
});

test("rejects targets that cannot produce a split", () => {
  assert.throws(
    () => planCompleteRefinement({ outcomeCount: 2, targetPartition: [[3n, 0n, 0n, 0n]] }),
    /at least two subsets/,
  );
});

test("builds split and reverse merge plans from the same deterministic steps", async () => {
  const owner = await generateKeyPairSigner();
  const targetPartition = Array.from({ length: 20 }, (_, outcome) => singleton(outcome));
  const base = {
    payer: owner,
    owner,
    ownerTokenAccount: tokenAccount,
    collateralMint: mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    conditionId: new Uint8Array(32).fill(45),
    outcomeCount: 20,
    targetPartition,
    amount: 50n,
  };
  const split = await getCompleteRefinementInstructionPlan({ ...base, direction: "split" });
  const merge = await getCompleteRefinementInstructionPlan({ ...base, direction: "merge" });

  assert.equal(split.steps.length, 2);
  assert(split.steps.every((step) => step.setupInstructions.length > 0));
  assert.equal(merge.steps.length, 2);
  assert(merge.steps.every((step) => step.setupInstructions.length === 0));
  assert.match(split.steps[0]!.id, /^split:refinement:0:/);
  assert.match(merge.steps[1]!.id, /^merge:refinement:0:/);

  const flattened = flattenInstructionPlan(split);
  assert.equal(flattened.at(-1)!.kind, "execute");
  assert.equal(flattened.filter((step) => step.kind === "execute").length, 2);
  assert.deepEqual(
    getPendingPlanSteps(flattened, new Set(flattened.slice(0, 3).map((step) => step.id))),
    flattened.slice(3),
  );
  assert.throws(
    () => getPendingPlanSteps(flattened, new Set([flattened[1]!.id])),
    /contiguous prefix/,
  );
});

test("consolidates and chunks large native transfers into complete batches", async () => {
  const owner = await generateKeyPairSigner();
  const transfers = Array.from({ length: 33 }, (_, index) => ({
    positionId: new Uint8Array(32).fill(index + 1),
    amount: 1n,
  }));
  transfers.push({ positionId: Uint8Array.from(transfers[0]!.positionId), amount: 2n });
  const batches = planNativeTransferBatches(transfers);
  assert.deepEqual(
    batches.map((batch) => batch.transfers.length),
    [16, 16, 1],
  );
  assert.equal(batches[0]!.transfers[0]!.amount, 3n);

  const plan = await getBatchTransferInstructionPlan({
    payer: owner,
    owner,
    recipient,
    transfers,
  });
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(
    plan.steps.map((step) => step.setupInstructions.length),
    [16, 16, 1],
  );
});

function singleton(outcome: number): IndexSetWords {
  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  words[Math.floor(outcome / 64)] = 1n << BigInt(outcome % 64);
  return words;
}
