import { sha256 } from "@noble/hashes/sha2.js";
import {
  getAddressEncoder,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { getIndexSetUniverse, unionIndexSets } from "./composition/index-set.ts";
import type { IndexSetWords } from "./identity.ts";
import { validatePartition } from "./math.ts";
import {
  getMergeNativePositionsInstruction,
  getNativePositionSetupInstructions,
  getSplitNativePositionInstruction,
} from "./positions/native-position.ts";
import {
  getMergeRootCollateralInstruction,
  getRootCollateralSetupInstructions,
  getSplitRootCollateralInstruction,
} from "./positions/root-collateral.ts";
import {
  getBatchTransferNativePositionsInstruction,
  getBatchTransferSetupInstructions,
  type NativePositionTransfer,
} from "./positions/transfers.ts";

const DEFAULT_MAX_CHILDREN = 16;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const PLAN_ID_DOMAIN = new TextEncoder().encode("CC_TOKEN_PLAN_V1");

export type RefinementPlanStep = Readonly<{
  id: string;
  index: number;
  kind: "root" | "native";
  sourceIndexSet: IndexSetWords;
  partition: readonly IndexSetWords[];
  continuationIndexSet?: IndexSetWords;
}>;

export type RefinementPlan = Readonly<{
  outcomeCount: number;
  targetPartition: readonly IndexSetWords[];
  maxChildren: number;
  steps: readonly RefinementPlanStep[];
}>;

export type InstructionPlanStep = Readonly<{
  id: string;
  planId: string;
  setupInstructions: readonly Instruction[];
  instruction: Instruction;
}>;

export type CompleteInstructionPlan = Readonly<{
  id: string;
  steps: readonly InstructionPlanStep[];
}>;

export type TransactionInstructionPlanStep = Readonly<{
  id: string;
  planId: string;
  kind: "setup" | "execute";
  instructions: readonly [Instruction];
}>;

export type CompletedPlanStep = Readonly<{
  planId: string;
  stepId: string;
}>;

export function planCompleteRefinement(input: {
  outcomeCount: number;
  targetPartition: readonly IndexSetWords[];
  maxChildren?: number;
}): RefinementPlan {
  const maxChildren = input.maxChildren ?? DEFAULT_MAX_CHILDREN;
  if (!Number.isInteger(maxChildren) || maxChildren < 2 || maxChildren > DEFAULT_MAX_CHILDREN) {
    throw new RangeError("maxChildren must be between 2 and 16");
  }
  if (input.targetPartition.length < 2) {
    throw new RangeError("a refinement target must contain at least two subsets");
  }
  if (!validatePartition(input.outcomeCount, input.targetPartition).isFull) {
    throw new RangeError("a complete refinement target must cover every outcome");
  }

  let remaining = input.targetPartition.map(copyIndexSet);
  let sourceIndexSet = getIndexSetUniverse(input.outcomeCount);
  const steps: RefinementPlanStep[] = [];
  while (remaining.length > maxChildren) {
    const terminalCount = maxChildren - 1;
    const terminal = remaining.slice(0, terminalCount);
    remaining = remaining.slice(terminalCount);
    const continuationIndexSet = unionAll(input.outcomeCount, remaining);
    const partition = [...terminal, continuationIndexSet];
    steps.push({
      id: refinementStepId(steps.length, partition),
      index: steps.length,
      kind: steps.length === 0 ? "root" : "native",
      sourceIndexSet,
      partition,
      continuationIndexSet,
    });
    sourceIndexSet = continuationIndexSet;
  }
  steps.push({
    id: refinementStepId(steps.length, remaining),
    index: steps.length,
    kind: steps.length === 0 ? "root" : "native",
    sourceIndexSet,
    partition: remaining,
  });

  return {
    outcomeCount: input.outcomeCount,
    targetPartition: input.targetPartition.map(copyIndexSet),
    maxChildren,
    steps,
  };
}

export async function getCompleteRefinementInstructionPlan(input: {
  direction: "split" | "merge";
  payer: TransactionSigner;
  owner: TransactionSigner;
  ownerTokenAccount: Address;
  collateralMint: Address;
  tokenProgram: Address;
  conditionId: Uint8Array;
  outcomeCount: number;
  targetPartition: readonly IndexSetWords[];
  amount: bigint;
  acceptIssuerControlled?: boolean;
  maxChildren?: number;
}): Promise<CompleteInstructionPlan> {
  validateAmount(input.amount);
  const refinement = planCompleteRefinement(input);
  const orderedSteps =
    input.direction === "split" ? refinement.steps : [...refinement.steps].reverse();
  const steps = await Promise.all(
    orderedSteps.map(async (step) => {
      if (step.kind === "root") {
        const transitionInput = {
          owner: input.owner,
          ownerTokenAccount: input.ownerTokenAccount,
          collateralMint: input.collateralMint,
          tokenProgram: input.tokenProgram,
          conditionId: input.conditionId,
          outcomeCount: input.outcomeCount,
          partition: step.partition,
          amount: input.amount,
          acceptIssuerControlled: input.acceptIssuerControlled,
        };
        return {
          id: `${input.direction}:${step.id}`,
          setupInstructions:
            input.direction === "split"
              ? await getRootCollateralSetupInstructions({
                  payer: input.payer,
                  owner: input.owner.address,
                  collateralMint: input.collateralMint,
                  conditionId: input.conditionId,
                  outcomeCount: input.outcomeCount,
                  partition: step.partition,
                })
              : [],
          instruction:
            input.direction === "split"
              ? await getSplitRootCollateralInstruction(transitionInput)
              : await getMergeRootCollateralInstruction(transitionInput),
        };
      }

      const transitionInput = {
        owner: input.owner,
        collateralMint: input.collateralMint,
        parentCollectionId: new Uint8Array(32),
        conditionId: input.conditionId,
        outcomeCount: input.outcomeCount,
        partition: step.partition,
        amount: input.amount,
      };
      return {
        id: `${input.direction}:${step.id}`,
        setupInstructions:
          input.direction === "split"
            ? await getNativePositionSetupInstructions({
                payer: input.payer,
                owner: input.owner.address,
                collateralMint: input.collateralMint,
                parentCollectionId: new Uint8Array(32),
                conditionId: input.conditionId,
                outcomeCount: input.outcomeCount,
                partition: step.partition,
              })
            : [],
        instruction:
          input.direction === "split"
            ? await getSplitNativePositionInstruction(transitionInput)
            : await getMergeNativePositionsInstruction(transitionInput),
      };
    }),
  );
  return bindInstructionPlan(`${input.direction}:refinement`, steps);
}

export function planNativeTransferBatches(
  transfers: readonly NativePositionTransfer[],
): readonly Readonly<{ id: string; transfers: readonly NativePositionTransfer[] }>[] {
  if (transfers.length === 0) throw new RangeError("a transfer plan must not be empty");
  const consolidated = new Map<string, { positionId: Uint8Array; amount: bigint }>();
  for (const transfer of transfers) {
    if (transfer.positionId.length !== 32) {
      throw new RangeError("positionId must contain 32 bytes");
    }
    validateAmount(transfer.amount);
    const key = bytesKey(transfer.positionId);
    const existing = consolidated.get(key);
    const amount = (existing?.amount ?? 0n) + transfer.amount;
    if (amount > MAX_U64) throw new RangeError("consolidated transfer amount exceeds u64::MAX");
    if (existing) existing.amount = amount;
    else consolidated.set(key, { positionId: Uint8Array.from(transfer.positionId), amount });
  }

  const normalized = [...consolidated.values()];
  return Array.from(
    { length: Math.ceil(normalized.length / DEFAULT_MAX_CHILDREN) },
    (_, index) => ({
      id: `transfer:${index}`,
      transfers: normalized.slice(index * DEFAULT_MAX_CHILDREN, (index + 1) * DEFAULT_MAX_CHILDREN),
    }),
  );
}

export async function getBatchTransferInstructionPlan(input: {
  payer: TransactionSigner;
  owner: TransactionSigner;
  recipient: Address;
  transfers: readonly NativePositionTransfer[];
}): Promise<CompleteInstructionPlan> {
  const batches = planNativeTransferBatches(input.transfers);
  const steps = await Promise.all(
    batches.map(async (batch) => ({
      id: batch.id,
      setupInstructions: await getBatchTransferSetupInstructions({
        payer: input.payer,
        recipient: input.recipient,
        transfers: batch.transfers,
      }),
      instruction: await getBatchTransferNativePositionsInstruction({
        owner: input.owner,
        recipient: input.recipient,
        transfers: batch.transfers,
      }),
    })),
  );
  return bindInstructionPlan("batch-transfer", steps);
}

export function getPendingPlanSteps<TStep extends Readonly<{ id: string; planId: string }>>(
  steps: readonly TStep[],
  completedSteps: readonly CompletedPlanStep[],
): readonly TStep[] {
  if (steps.length === 0) return [];
  const planId = steps[0]!.planId;
  if (steps.some((step) => step.planId !== planId)) {
    throw new Error("plan steps must share one plan ID");
  }
  if (completedSteps.some((step) => step.planId !== planId)) {
    throw new Error("completed plan steps do not belong to this plan");
  }
  const completedStepIds = new Set(completedSteps.map((step) => step.stepId));
  let completedPrefix = 0;
  while (completedPrefix < steps.length && completedStepIds.has(steps[completedPrefix]!.id)) {
    completedPrefix += 1;
  }
  for (let index = completedPrefix; index < steps.length; index += 1) {
    if (completedStepIds.has(steps[index]!.id)) {
      throw new Error("completed plan steps must form a contiguous prefix");
    }
  }
  return steps.slice(completedPrefix);
}

export function flattenInstructionPlan(
  plan: CompleteInstructionPlan,
): readonly TransactionInstructionPlanStep[] {
  return plan.steps.flatMap((step) => [
    ...step.setupInstructions.map((instruction, index): TransactionInstructionPlanStep => ({
      id: `${step.id}:setup:${index}`,
      planId: plan.id,
      kind: "setup",
      instructions: [instruction],
    })),
    {
      id: `${step.id}:execute`,
      planId: plan.id,
      kind: "execute",
      instructions: [step.instruction],
    } satisfies TransactionInstructionPlanStep,
  ]);
}

function unionAll(outcomeCount: number, indexSets: readonly IndexSetWords[]): IndexSetWords {
  return indexSets.reduce<IndexSetWords>(
    (union, indexSet) => unionIndexSets(outcomeCount, union, indexSet),
    [0n, 0n, 0n, 0n],
  );
}

function copyIndexSet(indexSet: IndexSetWords): IndexSetWords {
  return [indexSet[0], indexSet[1], indexSet[2], indexSet[3]];
}

function refinementStepId(index: number, partition: readonly IndexSetWords[]): string {
  return `refinement:${index}:${partition.map(bytesKey).join("-")}`;
}

function bindInstructionPlan(
  kind: string,
  steps: readonly Readonly<{
    setupInstructions: readonly Instruction[];
    instruction: Instruction;
  }>[],
): CompleteInstructionPlan {
  const planId = `${kind}:${instructionPlanFingerprint(kind, steps)}`;
  return {
    id: planId,
    steps: steps.map((step, index) => ({
      ...step,
      id: `${planId}:${index}`,
      planId,
    })),
  };
}

function instructionPlanFingerprint(
  kind: string,
  steps: readonly Readonly<{
    setupInstructions: readonly Instruction[];
    instruction: Instruction;
  }>[],
): string {
  const kindBytes = new TextEncoder().encode(kind);
  const chunks = [
    PLAN_ID_DOMAIN,
    encodeLength(kindBytes.length),
    kindBytes,
    encodeLength(steps.length),
  ];
  for (const step of steps) {
    const instructions = [...step.setupInstructions, step.instruction];
    chunks.push(encodeLength(instructions.length));
    for (const instruction of instructions) chunks.push(encodeInstruction(instruction));
  }
  return Array.from(sha256(concatBytes(chunks)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function encodeInstruction(instruction: Instruction): Uint8Array {
  const accounts = instruction.accounts ?? [];
  const data = instruction.data ?? new Uint8Array();
  const chunks: Uint8Array[] = [
    Uint8Array.from(getAddressEncoder().encode(instruction.programAddress)),
    encodeLength(accounts.length),
  ];
  for (const account of accounts) {
    chunks.push(
      Uint8Array.from(getAddressEncoder().encode(account.address)),
      Uint8Array.of(account.role),
    );
  }
  chunks.push(encodeLength(data.length), Uint8Array.from(data));
  return concatBytes(chunks);
}

function encodeLength(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("plan length must fit in u32");
  }
  return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function validateAmount(amount: bigint): void {
  if (amount <= 0n || amount > MAX_U64) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
}

function bytesKey(indexSet: ArrayLike<number | bigint>): string {
  return Array.from(indexSet, (value) => value.toString(16).padStart(16, "0")).join("");
}
