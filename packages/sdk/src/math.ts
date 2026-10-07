import type { IndexSetWords } from "./identity.ts";
import {
  getIndexSetUniverse,
  indexSetsEqual,
  validateProperIndexSet,
} from "./composition/index-set.ts";

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;

export type ValidatedPartition = Readonly<{
  union: IndexSetWords;
  isFull: boolean;
}>;

export type PayoutRatio = Readonly<{
  numerator: bigint;
  denominator: bigint;
}>;

export function validatePartition(
  outcomeCount: number,
  partition: readonly IndexSetWords[],
): ValidatedPartition {
  if (partition.length < 2) throw new RangeError("a partition must contain at least two subsets");
  const universe = getIndexSetUniverse(outcomeCount);
  const union: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];

  for (const subset of partition) {
    validateProperIndexSet(outcomeCount, subset);
    for (let index = 0; index < union.length; index += 1) {
      if ((union[index] & subset[index]) !== 0n) {
        throw new RangeError("partition subsets must not overlap");
      }
      union[index] |= subset[index];
    }
  }

  return { union, isFull: indexSetsEqual(union, universe) };
}

export function payoutRatio(
  payoutNumerators: readonly bigint[],
  indexSet: IndexSetWords,
): PayoutRatio {
  validateProperIndexSet(payoutNumerators.length, indexSet);

  let numerator = 0n;
  let denominator = 0n;
  for (let outcome = 0; outcome < payoutNumerators.length; outcome += 1) {
    const value = payoutNumerators[outcome];
    assertUnsigned(value, MAX_U64, "payout numerator");
    denominator += value;
    if (contains(indexSet, outcome)) numerator += value;
  }
  if (denominator === 0n) throw new RangeError("payout denominator must be greater than zero");
  return { numerator, denominator };
}

export function calculatePayout(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  assertUnsigned(amount, MAX_U64, "amount");
  assertUnsigned(numerator, MAX_U128, "numerator");
  assertUnsigned(denominator, MAX_U128, "denominator");
  if (denominator === 0n) throw new RangeError("payout denominator must be greater than zero");
  if (numerator > denominator) {
    throw new RangeError("payout numerator must not exceed its denominator");
  }
  return (amount * numerator) / denominator;
}

export function calculatePositionPayout(
  amount: bigint,
  payoutNumerators: readonly bigint[],
  indexSet: IndexSetWords,
): bigint {
  const ratio = payoutRatio(payoutNumerators, indexSet);
  return calculatePayout(amount, ratio.numerator, ratio.denominator);
}

function contains(indexSet: IndexSetWords, outcome: number): boolean {
  const word = Math.floor(outcome / 64);
  const bit = outcome % 64;
  return (indexSet[word] & (1n << BigInt(bit))) !== 0n;
}

function assertUnsigned(value: bigint, maximum: bigint, name: string): void {
  if (value < 0n || value > maximum) throw new RangeError(`${name} is out of range`);
}
