import type { ReadonlyUint8Array } from "@solana/kit";

import { deriveCollectionId, ROOT_COLLECTION_ID, type IndexSetWords } from "../identity.ts";
import {
  intersectIndexSets,
  isEmptyIndexSet,
  isFullIndexSet,
  validateIndexSet,
  validateProperIndexSet,
} from "./index-set.ts";

export type ConditionClause = Readonly<{
  conditionId: ReadonlyUint8Array;
  outcomeCount: number;
  indexSet: IndexSetWords;
}>;

export type CollectionRegistrationStep = Readonly<{
  parentCollectionId: ReadonlyUint8Array;
  collectionId: ReadonlyUint8Array;
  conditionId: ReadonlyUint8Array;
  indexSet: IndexSetWords;
}>;

export type CollectionCompositionPlan = Readonly<{
  factors: readonly ConditionClause[];
  steps: readonly CollectionRegistrationStep[];
  collectionId: ReadonlyUint8Array;
}>;

export function normalizeLogicalConjunction(
  clauses: readonly ConditionClause[],
): readonly ConditionClause[] {
  const grouped = new Map<string, ConditionClause>();

  for (const input of clauses) {
    const clause = copyClause(input);
    validateIndexSet(clause.outcomeCount, clause.indexSet);
    if (isEmptyIndexSet(clause.indexSet)) {
      throw new RangeError("logical clause must contain at least one outcome");
    }

    const key = identifierKey(clause.conditionId);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, clause);
      continue;
    }
    if (existing.outcomeCount !== clause.outcomeCount) {
      throw new RangeError("one condition ID cannot use different outcome counts");
    }

    const indexSet = intersectIndexSets(clause.outcomeCount, existing.indexSet, clause.indexSet);
    if (isEmptyIndexSet(indexSet)) throw new RangeError("logical conjunction is empty");
    grouped.set(key, { ...existing, indexSet });
  }

  return [...grouped.values()]
    .filter((clause) => !isFullIndexSet(clause.outcomeCount, clause.indexSet))
    .sort(compareFactors);
}

export function planLogicalConjunction(
  clauses: readonly ConditionClause[],
  parentCollectionId: ReadonlyUint8Array = ROOT_COLLECTION_ID,
): CollectionCompositionPlan {
  return planFactors(normalizeLogicalConjunction(clauses), parentCollectionId);
}

export function planExplicitProduct(
  inputs: readonly ConditionClause[],
  parentCollectionId: ReadonlyUint8Array = ROOT_COLLECTION_ID,
): CollectionCompositionPlan {
  const outcomeCounts = new Map<string, number>();
  const factors = inputs.map((input) => {
    const factor = copyClause(input);
    validateProperIndexSet(factor.outcomeCount, factor.indexSet);

    const key = identifierKey(factor.conditionId);
    const existingOutcomeCount = outcomeCounts.get(key);
    if (existingOutcomeCount !== undefined && existingOutcomeCount !== factor.outcomeCount) {
      throw new RangeError("one condition ID cannot use different outcome counts");
    }
    outcomeCounts.set(key, factor.outcomeCount);
    return factor;
  });

  return planFactors(factors.sort(compareFactors), parentCollectionId);
}

function planFactors(
  factors: readonly ConditionClause[],
  parentCollectionId: ReadonlyUint8Array,
): CollectionCompositionPlan {
  assertIdentifier(parentCollectionId, "parentCollectionId");
  let collectionId: ReadonlyUint8Array = Uint8Array.from(parentCollectionId);
  const steps = factors.map((factor) => {
    const parentCollectionId = collectionId;
    collectionId = deriveCollectionId(
      parentCollectionId,
      factor.conditionId,
      factor.indexSet,
    ).collectionId;
    return {
      parentCollectionId,
      collectionId,
      conditionId: factor.conditionId,
      indexSet: factor.indexSet,
    };
  });

  return { factors, steps, collectionId };
}

function copyClause(clause: ConditionClause): ConditionClause {
  assertIdentifier(clause.conditionId, "conditionId");
  return {
    conditionId: Uint8Array.from(clause.conditionId),
    outcomeCount: clause.outcomeCount,
    indexSet: [clause.indexSet[0], clause.indexSet[1], clause.indexSet[2], clause.indexSet[3]],
  };
}

function compareFactors(left: ConditionClause, right: ConditionClause): number {
  const conditionOrder = compareBytes(left.conditionId, right.conditionId);
  if (conditionOrder !== 0) return conditionOrder;
  if (left.outcomeCount !== right.outcomeCount) return left.outcomeCount - right.outcomeCount;
  for (let index = left.indexSet.length - 1; index >= 0; index -= 1) {
    if (left.indexSet[index] < right.indexSet[index]) return -1;
    if (left.indexSet[index] > right.indexSet[index]) return 1;
  }
  return 0;
}

function compareBytes(left: ReadonlyUint8Array, right: ReadonlyUint8Array): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function identifierKey(identifier: ReadonlyUint8Array): string {
  return Array.from(identifier, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertIdentifier(identifier: ReadonlyUint8Array, name: string): void {
  if (identifier.length !== 32) throw new RangeError(`${name} must contain 32 bytes`);
}
