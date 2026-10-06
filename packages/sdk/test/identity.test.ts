import assert from "node:assert/strict";
import { test } from "node:test";

import { address } from "@solana/kit";

import { deriveCollectionId, deriveConditionId, ROOT_COLLECTION_ID } from "../src/identity.ts";
import { selectTransactionVersion } from "../src/transactions.ts";

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

test("derives the Rust condition fixture", () => {
  const resolver = address("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx");
  const conditionId = deriveConditionId(resolver, new Uint8Array(32).fill(9), 8);
  assert.deepEqual(
    conditionId,
    hex("0c78673028e10c4a29a2734062f0d3eb7fff32139df5147f3750a20772b32400"),
  );
});

test("derives the published Gnosis collection fixture", () => {
  const conditionId = hex("67eb23e8932765c1d7a094838c928476df8c50d1d3898f278ef1fb2a62afab63");
  const expected = hex("229b067e142fce0aea84afb935095c6ecbea8647b8a013e795cc0ced3210a3d5");
  const actual = deriveCollectionId(ROOT_COLLECTION_ID, conditionId, [3n, 0n, 0n, 0n]);
  assert.deepEqual(actual.collectionId, expected);
  assert(actual.hashAttempts > 0);
});

test("composition is commutative and preserves multiplicity", () => {
  const conditionA = new Uint8Array(32).fill(3);
  const conditionB = new Uint8Array(32).fill(5);
  const indexA = [1n, 0n, 0n, 0n] as const;
  const indexB = [2n, 0n, 0n, 0n] as const;
  const atomicA = deriveCollectionId(ROOT_COLLECTION_ID, conditionA, indexA).collectionId;
  const atomicB = deriveCollectionId(ROOT_COLLECTION_ID, conditionB, indexB).collectionId;
  const aThenB = deriveCollectionId(atomicA, conditionB, indexB).collectionId;
  const bThenA = deriveCollectionId(atomicB, conditionA, indexA).collectionId;
  const repeatedA = deriveCollectionId(atomicA, conditionA, indexA).collectionId;

  assert.deepEqual(aThenB, bThenA);
  assert.notDeepEqual(repeatedA, atomicA);
});

test("uses v0 unless the wallet supports the optional v1 path", () => {
  assert.equal(selectTransactionVersion(new Set([0])), 0);
  assert.equal(selectTransactionVersion(new Set([0, 1])), 1);
  assert.equal(selectTransactionVersion(new Set([0, 1]), false), 0);
});
