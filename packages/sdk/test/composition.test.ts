import assert from "node:assert/strict";
import { test } from "node:test";

import {
  complementIndexSet,
  getIndexSetUniverse,
  intersectIndexSets,
  normalizeLogicalConjunction,
  planExplicitProduct,
  planLogicalConjunction,
  ROOT_COLLECTION_ID,
  unionIndexSets,
  type IndexSetWords,
} from "../src/index.ts";

function conditionId(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function indexSet(...outcomes: number[]): IndexSetWords {
  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  for (const outcome of outcomes) {
    words[Math.floor(outcome / 64)] |= 1n << BigInt(outcome % 64);
  }
  return words;
}

test("combines masks across every word boundary", () => {
  const boundaryOutcomes = indexSet(0, 63, 64, 127, 128, 191, 192, 255);
  const alternatingBoundaries = indexSet(63, 127, 191, 255);

  assert.deepEqual(
    intersectIndexSets(256, boundaryOutcomes, alternatingBoundaries),
    alternatingBoundaries,
  );
  assert.deepEqual(
    unionIndexSets(256, boundaryOutcomes, indexSet(1, 65, 129, 193)),
    indexSet(0, 1, 63, 64, 65, 127, 128, 129, 191, 192, 193, 255),
  );
  assert.deepEqual(
    intersectIndexSets(256, boundaryOutcomes, complementIndexSet(256, alternatingBoundaries)),
    indexSet(0, 64, 128, 192),
  );
  assert.deepEqual(complementIndexSet(256, getIndexSetUniverse(256)), indexSet());

  for (const outcomeCount of [2, 3, 16, 255, 256]) {
    assert.deepEqual(
      complementIndexSet(outcomeCount, indexSet()),
      getIndexSetUniverse(outcomeCount),
    );
    assert.deepEqual(
      complementIndexSet(outcomeCount, getIndexSetUniverse(outcomeCount)),
      indexSet(),
    );
  }
});

test("normalizes overlapping SOL price filters before composition", () => {
  const solPrice = conditionId(17);
  const atLeast150 = { conditionId: solPrice, outcomeCount: 4, indexSet: indexSet(2, 3) };
  const atLeast200 = { conditionId: solPrice, outcomeCount: 4, indexSet: indexSet(3) };

  const logical = planLogicalConjunction([atLeast150, atLeast200]);
  const reversed = planLogicalConjunction([atLeast200, atLeast150]);
  const product = planExplicitProduct([atLeast150, atLeast200]);

  assert.deepEqual(logical, reversed);
  assert.equal(logical.factors.length, 1);
  assert.deepEqual(logical.factors[0]?.indexSet, indexSet(3));
  assert.equal(logical.steps.length, 1);
  assert.equal(product.factors.length, 2);
  assert.equal(product.steps.length, 2);
  assert.notDeepEqual(logical.collectionId, product.collectionId);
});

test("deduplicates logical repetition and preserves explicit multiplicity", () => {
  const clause = { conditionId: conditionId(9), outcomeCount: 8, indexSet: indexSet(2, 4) };

  const logical = planLogicalConjunction([clause, clause]);
  const product = planExplicitProduct([clause, clause]);

  assert.equal(logical.factors.length, 1);
  assert.equal(logical.steps.length, 1);
  assert.equal(product.factors.length, 2);
  assert.equal(product.steps.length, 2);
  assert.notDeepEqual(logical.collectionId, product.collectionId);
});

test("omits tautologies and rejects empty logical claims", () => {
  const condition = conditionId(5);
  const full = {
    conditionId: condition,
    outcomeCount: 4,
    indexSet: getIndexSetUniverse(4),
  };

  const tautology = planLogicalConjunction([full]);
  assert.deepEqual(tautology.collectionId, ROOT_COLLECTION_ID);
  assert.deepEqual(tautology.factors, []);
  assert.deepEqual(tautology.steps, []);

  assert.throws(() =>
    normalizeLogicalConjunction([
      { conditionId: condition, outcomeCount: 4, indexSet: indexSet(0) },
      { conditionId: condition, outcomeCount: 4, indexSet: indexSet(1) },
    ]),
  );
  assert.throws(() =>
    normalizeLogicalConjunction([
      { conditionId: condition, outcomeCount: 4, indexSet: indexSet() },
    ]),
  );
});

test("produces the same deterministic plan for every input order", () => {
  const lowId = { conditionId: conditionId(3), outcomeCount: 3, indexSet: indexSet(0, 2) };
  const highId = { conditionId: conditionId(8), outcomeCount: 8, indexSet: indexSet(7) };

  const forward = planExplicitProduct([highId, highId, lowId]);
  const reverse = planExplicitProduct([lowId, highId, highId]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.factors.map((factor) => factor.conditionId),
    [lowId.conditionId, highId.conditionId, highId.conditionId],
  );
  assert.deepEqual(forward.steps[0]?.parentCollectionId, ROOT_COLLECTION_ID);
  assert.deepEqual(forward.steps.at(-1)?.collectionId, forward.collectionId);
});

test("continues a registration plan from an existing parent", () => {
  const firstFactor = {
    conditionId: conditionId(2),
    outcomeCount: 3,
    indexSet: indexSet(0),
  };
  const secondFactor = {
    conditionId: conditionId(7),
    outcomeCount: 8,
    indexSet: indexSet(4, 5),
  };
  const firstPlan = planExplicitProduct([firstFactor]);
  const continuation = planExplicitProduct([secondFactor], firstPlan.collectionId);
  const complete = planExplicitProduct([secondFactor, firstFactor]);

  assert.deepEqual(continuation.steps[0]?.parentCollectionId, firstPlan.collectionId);
  assert.deepEqual(continuation.collectionId, complete.collectionId);
});

test("keeps cross-condition clauses separate and validates their domains", () => {
  const condition = conditionId(4);
  const otherCondition = conditionId(6);
  const factors = normalizeLogicalConjunction([
    { conditionId: condition, outcomeCount: 8, indexSet: indexSet(1, 2, 3) },
    { conditionId: otherCondition, outcomeCount: 2, indexSet: indexSet(1) },
  ]);

  assert.equal(factors.length, 2);
  assert.throws(() =>
    normalizeLogicalConjunction([
      { conditionId: condition, outcomeCount: 8, indexSet: indexSet(1) },
      { conditionId: condition, outcomeCount: 16, indexSet: indexSet(1) },
    ]),
  );
  assert.throws(() =>
    planExplicitProduct([
      { conditionId: condition, outcomeCount: 8, indexSet: getIndexSetUniverse(8) },
    ]),
  );
  assert.throws(() =>
    planExplicitProduct([{ conditionId: condition, outcomeCount: 8, indexSet: indexSet() }]),
  );
  assert.throws(() => complementIndexSet(8, indexSet(8)));
  assert.throws(() =>
    planExplicitProduct([
      { conditionId: new Uint8Array(31), outcomeCount: 8, indexSet: indexSet(1) },
    ]),
  );
});
