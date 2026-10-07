import type { IndexSetWords } from "./identity.ts";

const MAX_OUTCOME_COUNT = 256;
const MIN_OUTCOME_COUNT = 2;
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
  const universe = getUniverse(outcomeCount);
  const union: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];

  for (const subset of partition) {
    validateIndexSet(subset, universe);
    for (let index = 0; index < union.length; index += 1) {
      if ((union[index] & subset[index]) !== 0n) {
        throw new RangeError("partition subsets must not overlap");
      }
      union[index] |= subset[index];
    }
  }

  return { union, isFull: wordsEqual(union, universe) };
}

export function payoutRatio(
  payoutNumerators: readonly bigint[],
  indexSet: IndexSetWords,
): PayoutRatio {
  const universe = getUniverse(payoutNumerators.length);
  validateIndexSet(indexSet, universe);

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

function getUniverse(outcomeCount: number): IndexSetWords {
  if (
    !Number.isInteger(outcomeCount) ||
    outcomeCount < MIN_OUTCOME_COUNT ||
    outcomeCount > MAX_OUTCOME_COUNT
  ) {
    throw new RangeError("outcomeCount must be between 2 and 256");
  }

  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  const fullWords = Math.floor(outcomeCount / 64);
  for (let index = 0; index < fullWords; index += 1) words[index] = MAX_U64;
  const remainingBits = outcomeCount % 64;
  if (remainingBits !== 0) words[fullWords] = (1n << BigInt(remainingBits)) - 1n;
  return words;
}

function validateIndexSet(indexSet: IndexSetWords, universe: IndexSetWords): void {
  if (indexSet.length !== 4) throw new RangeError("indexSet must contain four words");
  let empty = true;
  for (let index = 0; index < indexSet.length; index += 1) {
    const word = indexSet[index];
    assertUnsigned(word, MAX_U64, "indexSet word");
    if (word !== 0n) empty = false;
    if ((word & (MAX_U64 ^ universe[index])) !== 0n) {
      throw new RangeError("indexSet contains an outcome outside the condition");
    }
  }
  if (empty) throw new RangeError("indexSet must contain at least one outcome");
  if (wordsEqual(indexSet, universe)) {
    throw new RangeError("indexSet must be a proper subset of the condition outcomes");
  }
}

function contains(indexSet: IndexSetWords, outcome: number): boolean {
  const word = Math.floor(outcome / 64);
  const bit = outcome % 64;
  return (indexSet[word] & (1n << BigInt(bit))) !== 0n;
}

function wordsEqual(left: IndexSetWords, right: IndexSetWords): boolean {
  return left.every((word, index) => word === right[index]);
}

function assertUnsigned(value: bigint, maximum: bigint, name: string): void {
  if (value < 0n || value > maximum) throw new RangeError(`${name} is out of range`);
}
