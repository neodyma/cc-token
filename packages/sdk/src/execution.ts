export type ExecutionPhase =
  | "build"
  | "signature"
  | "simulation"
  | "checkpoint"
  | "submission"
  | "confirmation"
  | "refetch"
  | "reconciliation";

export type ExecutionStatus = "prepared" | "submitted" | "confirmed" | "refetched";

export type SimulationResult = Readonly<{
  err: unknown | null;
  logs?: readonly string[] | null;
}>;

export type ExecutionCheckpoint<TTransaction, TSignature, TState = unknown> = Readonly<{
  planId: string;
  stepId: string;
  transaction: TTransaction;
  signature: TSignature;
  status: ExecutionStatus;
  state?: TState;
}>;

export type ExecutionReceipt<TState, TSignature> = Readonly<{
  planId: string;
  stepId: string;
  signature: TSignature;
  state: TState;
}>;

export type ConfirmedPlanAdapter<TStep, TTransaction, TSignature, TState> = Readonly<{
  loadCheckpoint(
    step: TStep,
  ): Promise<ExecutionCheckpoint<TTransaction, TSignature, TState> | undefined>;
  getStatus(signature: TSignature, step: TStep): Promise<ReconciliationStatus>;
  buildTransaction(step: TStep): Promise<TTransaction>;
  getSignature(transaction: TTransaction, step: TStep): Promise<TSignature> | TSignature;
  simulate(transaction: TTransaction, step: TStep): Promise<SimulationResult>;
  recordCheckpoint(
    checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
    step: TStep,
  ): Promise<void>;
  submit(transaction: TTransaction, step: TStep): Promise<void>;
  confirm(signature: TSignature, step: TStep): Promise<void>;
  refetch(step: TStep, signature: TSignature): Promise<TState>;
}>;

export type ReconciliationStatus = "confirmed" | "failed" | "expired" | "unknown";

export type ReconciliationAdapter<TStep, TTransaction, TSignature, TState> = Readonly<{
  getStatus(signature: TSignature, step: TStep): Promise<ReconciliationStatus>;
  refetch(step: TStep, signature: TSignature): Promise<TState>;
  recordCheckpoint(
    checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
    step: TStep,
  ): Promise<void>;
}>;

export type ReconciliationResult<TState, TSignature> =
  | Readonly<{ status: "complete"; receipt: ExecutionReceipt<TState, TSignature> }>
  | Readonly<{ status: "retryable" | "pending" }>;

export class PlanExecutionError<
  TTransaction = unknown,
  TState = unknown,
  TSignature = unknown,
> extends Error {
  readonly phase: ExecutionPhase;
  readonly planId: string;
  readonly stepId: string;
  readonly checkpoint?: ExecutionCheckpoint<TTransaction, TSignature, TState>;
  readonly logs?: readonly string[];
  readonly completed: readonly ExecutionReceipt<TState, TSignature>[];

  constructor(input: {
    phase: ExecutionPhase;
    planId: string;
    stepId: string;
    cause: unknown;
    checkpoint?: ExecutionCheckpoint<TTransaction, TSignature, TState>;
    logs?: readonly string[] | null;
    completed: readonly ExecutionReceipt<TState, TSignature>[];
  }) {
    super(`transaction plan failed during ${input.phase} at ${input.stepId}`, {
      cause: input.cause,
    });
    this.name = "PlanExecutionError";
    this.phase = input.phase;
    this.planId = input.planId;
    this.stepId = input.stepId;
    this.checkpoint = input.checkpoint;
    this.logs = input.logs ?? undefined;
    this.completed = input.completed;
  }
}

export async function executeConfirmedPlan<
  TStep extends Readonly<{ id: string; planId: string }>,
  TTransaction,
  TSignature,
  TState,
>(
  steps: readonly TStep[],
  adapter: ConfirmedPlanAdapter<TStep, TTransaction, TSignature, TState>,
): Promise<readonly ExecutionReceipt<TState, TSignature>[]> {
  const completed: ExecutionReceipt<TState, TSignature>[] = [];
  for (const step of steps) {
    let existingCheckpoint: ExecutionCheckpoint<TTransaction, TSignature, TState> | undefined;
    try {
      existingCheckpoint = await adapter.loadCheckpoint(step);
    } catch (cause) {
      throw executionError("reconciliation", step, cause, completed);
    }
    if (existingCheckpoint) {
      let reconciliation: ReconciliationResult<TState, TSignature>;
      try {
        reconciliation = await reconcileExecutionCheckpoint(step, existingCheckpoint, adapter);
      } catch (cause) {
        throw executionError("reconciliation", step, cause, completed, existingCheckpoint);
      }
      if (reconciliation.status === "complete") {
        completed.push(reconciliation.receipt);
        continue;
      }
      if (reconciliation.status === "pending") {
        throw executionError(
          "reconciliation",
          step,
          new Error("transaction status is unresolved"),
          completed,
          existingCheckpoint,
        );
      }
    }

    let transaction: TTransaction;
    try {
      transaction = await adapter.buildTransaction(step);
    } catch (cause) {
      throw executionError("build", step, cause, completed);
    }

    let signature: TSignature;
    try {
      signature = await adapter.getSignature(transaction, step);
    } catch (cause) {
      throw executionError("signature", step, cause, completed);
    }

    let simulation: SimulationResult;
    try {
      simulation = await adapter.simulate(transaction, step);
    } catch (cause) {
      throw executionError("simulation", step, cause, completed);
    }
    if (simulation.err !== null) {
      throw executionError(
        "simulation",
        step,
        simulation.err,
        completed,
        undefined,
        simulation.logs,
      );
    }

    let checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState> = {
      planId: step.planId,
      stepId: step.id,
      transaction,
      signature,
      status: "prepared",
    };
    await recordCheckpoint(adapter, checkpoint, step, completed);

    try {
      await adapter.submit(transaction, step);
    } catch (cause) {
      throw executionError("submission", step, cause, completed, checkpoint);
    }
    checkpoint = { ...checkpoint, status: "submitted" };
    await recordCheckpoint(adapter, checkpoint, step, completed);

    try {
      await adapter.confirm(signature, step);
    } catch (cause) {
      throw executionError("confirmation", step, cause, completed, checkpoint);
    }
    checkpoint = { ...checkpoint, status: "confirmed" };
    await recordCheckpoint(adapter, checkpoint, step, completed);

    let state: TState;
    try {
      state = await adapter.refetch(step, signature);
    } catch (cause) {
      throw executionError("refetch", step, cause, completed, checkpoint);
    }
    checkpoint = { ...checkpoint, status: "refetched", state };
    await recordCheckpoint(adapter, checkpoint, step, completed);
    completed.push({ planId: step.planId, stepId: step.id, signature, state });
  }
  return completed;
}

export async function reconcileExecutionCheckpoint<
  TStep extends Readonly<{ id: string; planId: string }>,
  TTransaction,
  TSignature,
  TState,
>(
  step: TStep,
  checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
  adapter: ReconciliationAdapter<TStep, TTransaction, TSignature, TState>,
): Promise<ReconciliationResult<TState, TSignature>> {
  requireMatchingCheckpoint(step, checkpoint);
  if (checkpoint.status === "refetched") {
    if (checkpoint.state === undefined) throw new Error("refetched checkpoint is missing state");
    return {
      status: "complete",
      receipt: {
        planId: step.planId,
        stepId: step.id,
        signature: checkpoint.signature,
        state: checkpoint.state,
      },
    };
  }

  const status =
    checkpoint.status === "confirmed"
      ? "confirmed"
      : await adapter.getStatus(checkpoint.signature, step);
  if (status === "failed" || status === "expired") return { status: "retryable" };
  if (status === "unknown") return { status: "pending" };

  const confirmed = { ...checkpoint, status: "confirmed" } as const;
  await adapter.recordCheckpoint(confirmed, step);
  let state: TState;
  try {
    state = await adapter.refetch(step, checkpoint.signature);
  } catch (cause) {
    throw executionError("reconciliation", step, cause, [], confirmed);
  }
  const refetched = { ...confirmed, status: "refetched", state } as const;
  await adapter.recordCheckpoint(refetched, step);
  return {
    status: "complete",
    receipt: {
      planId: step.planId,
      stepId: step.id,
      signature: checkpoint.signature,
      state,
    },
  };
}

async function recordCheckpoint<TStep, TTransaction, TSignature, TState>(
  adapter: ConfirmedPlanAdapter<TStep, TTransaction, TSignature, TState>,
  checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
  step: TStep & Readonly<{ id: string; planId: string }>,
  completed: readonly ExecutionReceipt<TState, TSignature>[],
): Promise<void> {
  try {
    await adapter.recordCheckpoint(checkpoint, step);
  } catch (cause) {
    throw executionError("checkpoint", step, cause, completed, checkpoint);
  }
}

function requireMatchingCheckpoint<TTransaction, TSignature, TState>(
  step: Readonly<{ id: string; planId: string }>,
  checkpoint: ExecutionCheckpoint<TTransaction, TSignature, TState>,
): void {
  if (checkpoint.planId !== step.planId || checkpoint.stepId !== step.id) {
    throw new Error("execution checkpoint does not belong to this plan step");
  }
}

function executionError<TTransaction, TState, TSignature>(
  phase: ExecutionPhase,
  step: Readonly<{ id: string; planId: string }>,
  cause: unknown,
  completed: readonly ExecutionReceipt<TState, TSignature>[],
  checkpoint?: ExecutionCheckpoint<TTransaction, TSignature, TState>,
  logs?: readonly string[] | null,
): PlanExecutionError<TTransaction, TState, TSignature> {
  return new PlanExecutionError({
    phase,
    planId: step.planId,
    stepId: step.id,
    cause,
    checkpoint,
    logs,
    completed: [...completed],
  });
}
