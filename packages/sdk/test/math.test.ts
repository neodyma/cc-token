import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  calculatePayout,
  calculatePositionPayout,
  payoutRatio,
  validatePartition,
  type IndexSetWords,
} from "../src/index.ts";

type PayoutFixture = Readonly<{
  name: string;
  amount: string;
  numerator: string;
  denominator: string;
  payout: string;
}>;

type PartitionFixture = Readonly<{
  name: string;
  outcomeCount: number;
  subsets: readonly (readonly [string, string, string, string])[];
  union: readonly [string, string, string, string];
  isFull: boolean;
}>;

const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/protocol_primitives.json", import.meta.url),
    "utf8",
  ),
) as Readonly<{
  partitions: readonly PartitionFixture[];
  payouts: readonly PayoutFixture[];
}>;

function indexSet(...outcomes: number[]): IndexSetWords {
  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  for (const outcome of outcomes) {
    words[Math.floor(outcome / 64)] |= 1n << BigInt(outcome % 64);
  }
  return words;
}

function parseWords(words: readonly [string, string, string, string]): IndexSetWords {
  return [BigInt(words[0]), BigInt(words[1]), BigInt(words[2]), BigInt(words[3])];
}

test("validates full and partial partitions across word boundaries", () => {
  for (const fixture of fixtures.partitions) {
    const actual = validatePartition(fixture.outcomeCount, fixture.subsets.map(parseWords));
    assert.deepEqual(actual.union, parseWords(fixture.union), fixture.name);
    assert.equal(actual.isFull, fixture.isFull, fixture.name);
  }
});

test("rejects invalid partition shapes", () => {
  assert.throws(() => validatePartition(8, []));
  assert.throws(() => validatePartition(8, [indexSet(0)]));
  assert.throws(() => validatePartition(8, [indexSet(0, 1), indexSet(1, 2)]));
  assert.throws(() => validatePartition(8, [indexSet(0), indexSet(0)]));
  assert.throws(() => validatePartition(8, [indexSet(), indexSet(0)]));
  assert.throws(() => validatePartition(8, [indexSet(0), indexSet(8)]));
});

test("matches every shared payout fixture", () => {
  for (const fixture of fixtures.payouts) {
    assert.equal(
      calculatePayout(
        BigInt(fixture.amount),
        BigInt(fixture.numerator),
        BigInt(fixture.denominator),
      ),
      BigInt(fixture.payout),
      fixture.name,
    );
  }
});

test("derives a selected payout ratio before applying it", () => {
  const maximum = (1n << 64n) - 1n;
  const payoutNumerators = Array<bigint>(255).fill(maximum);
  payoutNumerators.push(1n);
  const selected = [maximum, maximum, maximum, maximum >> 1n] as const;
  const ratio = payoutRatio(payoutNumerators, selected);

  assert.equal(ratio.numerator, 255n * maximum);
  assert.equal(ratio.denominator, ratio.numerator + 1n);
  assert.equal(calculatePositionPayout(maximum, payoutNumerators, selected), maximum - 1n);
});

test("rejects invalid payout inputs", () => {
  assert.throws(() => calculatePayout(1n, 0n, 0n));
  assert.throws(() => calculatePayout(1n, 2n, 1n));
  assert.throws(() => calculatePayout(-1n, 0n, 1n));
  assert.throws(() => payoutRatio([0n, 0n], indexSet(0)));
});
