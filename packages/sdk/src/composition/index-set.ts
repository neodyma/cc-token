import type { IndexSetWords } from "../identity.ts";

const MAX_OUTCOME_COUNT = 256;
const MIN_OUTCOME_COUNT = 2;
const MAX_U64 = (1n << 64n) - 1n;

export function getIndexSetUniverse(outcomeCount: number): IndexSetWords {
  assertOutcomeCount(outcomeCount);

  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  const fullWords = Math.floor(outcomeCount / 64);
  for (let index = 0; index < fullWords; index += 1) words[index] = MAX_U64;
  const remainingBits = outcomeCount % 64;
  if (remainingBits !== 0) words[fullWords] = (1n << BigInt(remainingBits)) - 1n;
  return words;
}

export function unionIndexSets(
  outcomeCount: number,
  left: IndexSetWords,
  right: IndexSetWords,
): IndexSetWords {
  validateIndexSet(outcomeCount, left);
  validateIndexSet(outcomeCount, right);
  return mapIndexSets(left, right, (leftWord, rightWord) => leftWord | rightWord);
}

export function intersectIndexSets(
  outcomeCount: number,
  left: IndexSetWords,
  right: IndexSetWords,
): IndexSetWords {
  validateIndexSet(outcomeCount, left);
  validateIndexSet(outcomeCount, right);
  return mapIndexSets(left, right, (leftWord, rightWord) => leftWord & rightWord);
}

export function complementIndexSet(outcomeCount: number, indexSet: IndexSetWords): IndexSetWords {
  const universe = getIndexSetUniverse(outcomeCount);
  validateIndexSet(outcomeCount, indexSet);
  return mapIndexSets(universe, indexSet, (universeWord, word) => universeWord ^ word);
}

export function validateIndexSet(outcomeCount: number, indexSet: IndexSetWords): void {
  const universe = getIndexSetUniverse(outcomeCount);
  if (indexSet.length !== 4) throw new RangeError("indexSet must contain four words");

  for (let index = 0; index < indexSet.length; index += 1) {
    const word = indexSet[index];
    if (word < 0n || word > MAX_U64) throw new RangeError("indexSet word is out of range");
    if ((word & (MAX_U64 ^ universe[index])) !== 0n) {
      throw new RangeError("indexSet contains an outcome outside the condition");
    }
  }
}

export function validateProperIndexSet(outcomeCount: number, indexSet: IndexSetWords): void {
  validateIndexSet(outcomeCount, indexSet);
  if (isEmptyIndexSet(indexSet)) {
    throw new RangeError("indexSet must contain at least one outcome");
  }
  if (indexSetsEqual(indexSet, getIndexSetUniverse(outcomeCount))) {
    throw new RangeError("indexSet must be a proper subset of the condition outcomes");
  }
}

export function isEmptyIndexSet(indexSet: IndexSetWords): boolean {
  return indexSet.every((word) => word === 0n);
}

export function isFullIndexSet(outcomeCount: number, indexSet: IndexSetWords): boolean {
  validateIndexSet(outcomeCount, indexSet);
  return indexSetsEqual(indexSet, getIndexSetUniverse(outcomeCount));
}

export function indexSetsEqual(left: IndexSetWords, right: IndexSetWords): boolean {
  return left.every((word, index) => word === right[index]);
}

function assertOutcomeCount(outcomeCount: number): void {
  if (
    !Number.isInteger(outcomeCount) ||
    outcomeCount < MIN_OUTCOME_COUNT ||
    outcomeCount > MAX_OUTCOME_COUNT
  ) {
    throw new RangeError("outcomeCount must be between 2 and 256");
  }
}

function mapIndexSets(
  left: IndexSetWords,
  right: IndexSetWords,
  operation: (leftWord: bigint, rightWord: bigint) => bigint,
): IndexSetWords {
  return [
    operation(left[0], right[0]),
    operation(left[1], right[1]),
    operation(left[2], right[2]),
    operation(left[3], right[3]),
  ];
}
