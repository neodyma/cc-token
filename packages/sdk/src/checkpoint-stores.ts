import type { ExecutionCheckpoint } from "./execution.ts";

export type PlanCheckpointStore<TTransaction, TSignature, TState = unknown> = Readonly<{
  load(
    planId: string,
    stepId: string,
  ): Promise<ExecutionCheckpoint<TTransaction, TSignature, TState> | undefined>;
  record(checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>): Promise<void>;
  remove(planId: string, stepId: string): Promise<void>;
}>;

export type WebStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}>;

export class MemoryPlanCheckpointStore<
  TTransaction,
  TSignature,
  TState = unknown,
> implements PlanCheckpointStore<TTransaction, TSignature, TState> {
  readonly #checkpoints = new Map<string, ExecutionCheckpoint<TTransaction, TSignature, TState>>();

  async load(
    planId: string,
    stepId: string,
  ): Promise<ExecutionCheckpoint<TTransaction, TSignature, TState> | undefined> {
    return this.#checkpoints.get(checkpointKey(planId, stepId));
  }

  async record(checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>): Promise<void> {
    this.#checkpoints.set(checkpointKey(checkpoint.planId, checkpoint.stepId), checkpoint);
  }

  async remove(planId: string, stepId: string): Promise<void> {
    this.#checkpoints.delete(checkpointKey(planId, stepId));
  }
}

export class WebStoragePlanCheckpointStore<
  TTransaction,
  TSignature,
  TState = unknown,
> implements PlanCheckpointStore<TTransaction, TSignature, TState> {
  readonly #storage: WebStorage;
  readonly #prefix: string;

  constructor(storage: WebStorage, prefix = "cc-token:checkpoint:") {
    this.#storage = storage;
    this.#prefix = prefix;
  }

  async load(
    planId: string,
    stepId: string,
  ): Promise<ExecutionCheckpoint<TTransaction, TSignature, TState> | undefined> {
    const stored = this.#storage.getItem(this.#key(planId, stepId));
    if (stored === null) return undefined;
    return decodeCheckpoint<TTransaction, TSignature, TState>(stored);
  }

  async record(checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>): Promise<void> {
    this.#storage.setItem(
      this.#key(checkpoint.planId, checkpoint.stepId),
      encodeCheckpoint(checkpoint),
    );
  }

  async remove(planId: string, stepId: string): Promise<void> {
    this.#storage.removeItem(this.#key(planId, stepId));
  }

  #key(planId: string, stepId: string): string {
    return `${this.#prefix}${encodeURIComponent(planId)}:${encodeURIComponent(stepId)}`;
  }
}

const TYPE_MARKER = "__ccTokenCheckpointType";

function encodeCheckpoint<TTransaction, TSignature, TState>(
  checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
): string {
  return JSON.stringify(checkpoint, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return { [TYPE_MARKER]: "bigint", value: value.toString() };
    }
    if (value instanceof Uint8Array) {
      return { [TYPE_MARKER]: "bytes", value: Array.from(value) };
    }
    return value;
  });
}

function decodeCheckpoint<TTransaction, TSignature, TState>(
  encoded: string,
): ExecutionCheckpoint<TTransaction, TSignature, TState> {
  const decoded: unknown = JSON.parse(encoded, (_key, value: unknown) => {
    if (!isRecord(value) || typeof value[TYPE_MARKER] !== "string") return value;
    if (value[TYPE_MARKER] === "bigint" && typeof value.value === "string") {
      return BigInt(value.value);
    }
    if (
      value[TYPE_MARKER] === "bytes" &&
      Array.isArray(value.value) &&
      value.value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      return Uint8Array.from(value.value);
    }
    throw new Error("invalid checkpoint value");
  });
  if (
    !isRecord(decoded) ||
    typeof decoded.planId !== "string" ||
    typeof decoded.stepId !== "string" ||
    !isExecutionStatus(decoded.status) ||
    !("transaction" in decoded) ||
    !("signature" in decoded)
  ) {
    throw new Error("invalid execution checkpoint");
  }
  return decoded as ExecutionCheckpoint<TTransaction, TSignature, TState>;
}

function checkpointKey(planId: string, stepId: string): string {
  return `${planId}\u0000${stepId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExecutionStatus(value: unknown): boolean {
  return (
    value === "prepared" || value === "submitted" || value === "confirmed" || value === "refetched"
  );
}
