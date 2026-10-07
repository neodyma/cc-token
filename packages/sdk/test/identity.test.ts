import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { address } from "@solana/kit";

import {
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  ROOT_COLLECTION_ID,
} from "../src/identity.ts";
import { selectTransactionVersion } from "../src/transactions.ts";

type Fixtures = Readonly<{
  condition: Readonly<{
    resolver: string;
    questionId: string;
    outcomeCount: number;
    conditionId: string;
  }>;
  collection: Readonly<{
    conditionId: string;
    indexSetWords: readonly [string, string, string, string];
    collectionId: string;
  }>;
  position: Readonly<{
    collateralMint: string;
    collectionId: string;
    positionId: string;
  }>;
}>;

const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/protocol_primitives.json", import.meta.url),
    "utf8",
  ),
) as Fixtures;

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

function parseWords(words: readonly [string, string, string, string]) {
  return [BigInt(words[0]), BigInt(words[1]), BigInt(words[2]), BigInt(words[3])] as const;
}

test("derives the Rust condition fixture", () => {
  const fixture = fixtures.condition;
  const conditionId = deriveConditionId(
    address(fixture.resolver),
    hex(fixture.questionId),
    fixture.outcomeCount,
  );
  assert.deepEqual(conditionId, hex(fixture.conditionId));
});

test("derives the published Gnosis collection fixture", () => {
  const fixture = fixtures.collection;
  const actual = deriveCollectionId(
    ROOT_COLLECTION_ID,
    hex(fixture.conditionId),
    parseWords(fixture.indexSetWords),
  );
  assert.deepEqual(actual.collectionId, hex(fixture.collectionId));
  assert(actual.hashAttempts > 0);
});

test("derives the Rust position fixture", () => {
  const fixture = fixtures.position;
  assert.deepEqual(
    derivePositionId(address(fixture.collateralMint), hex(fixture.collectionId)),
    hex(fixture.positionId),
  );
  assert.throws(() => derivePositionId(address(fixture.collateralMint), ROOT_COLLECTION_ID));
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
