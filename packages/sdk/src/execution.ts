export type ExecutionPhase = "build" | "simulation" | "submission" | "confirmation" | "refetch";

export type SimulationResult = Readonly<{
  err: unknown | null;
  logs?: readonly string[] | null;
}>;

export type ExecutionReceipt<TState, TSignature> = Readonly<{
  stepId: string;
  signature: TSignature;
  state: TState;
}>;

export type ConfirmedPlanAdapter<TStep, TTransaction, TSignature, TState> = Readonly<{
  buildTransaction(step: TStep): Promise<TTransaction>;
  simulate(transaction: TTransaction, step: TStep): Promise<SimulationResult>;
  submit(transaction: TTransaction, step: TStep): Promise<TSignature>;
  confirm(signature: TSignature, step: TStep): Promise<void>;
  refetch(step: TStep, signature: TSignature): Promise<TState>;
}>;

export class PlanExecutionError<TState = unknown, TSignature = unknown> extends Error {
  readonly phase: ExecutionPhase;
  readonly stepId: string;
  readonly signature?: TSignature;
  readonly logs?: readonly string[];
  readonly completed: readonly ExecutionReceipt<TState, TSignature>[];

  constructor(input: {
    phase: ExecutionPhase;
    stepId: string;
    cause: unknown;
    signature?: TSignature;
    logs?: readonly string[] | null;
    completed: readonly ExecutionReceipt<TState, TSignature>[];
  }) {
    super(`transaction plan failed during ${input.phase} at ${input.stepId}`, {
      cause: input.cause,
    });
    this.name = "PlanExecutionError";
    this.phase = input.phase;
    this.stepId = input.stepId;
    this.signature = input.signature;
    this.logs = input.logs ?? undefined;
    this.completed = input.completed;
  }
}

export async function executeConfirmedPlan<
  TStep extends Readonly<{ id: string }>,
  TTransaction,
  TSignature,
  TState,
>(
  steps: readonly TStep[],
  adapter: ConfirmedPlanAdapter<TStep, TTransaction, TSignature, TState>,
): Promise<readonly ExecutionReceipt<TState, TSignature>[]> {
  const completed: ExecutionReceipt<TState, TSignature>[] = [];
  for (const step of steps) {
    let transaction: TTransaction;
    try {
      transaction = await adapter.buildTransaction(step);
    } catch (cause) {
      throw executionError("build", step.id, cause, completed);
    }

    let simulation: SimulationResult;
    try {
      simulation = await adapter.simulate(transaction, step);
    } catch (cause) {
      throw executionError("simulation", step.id, cause, completed);
    }
    if (simulation.err !== null) {
      throw executionError(
        "simulation",
        step.id,
        simulation.err,
        completed,
        undefined,
        simulation.logs,
      );
    }

    let signature: TSignature;
    try {
      signature = await adapter.submit(transaction, step);
    } catch (cause) {
      throw executionError("submission", step.id, cause, completed);
    }
    try {
      await adapter.confirm(signature, step);
    } catch (cause) {
      throw executionError("confirmation", step.id, cause, completed, signature);
    }

    let state: TState;
    try {
      state = await adapter.refetch(step, signature);
    } catch (cause) {
      throw executionError("refetch", step.id, cause, completed, signature);
    }
    completed.push({ stepId: step.id, signature, state });
  }
  return completed;
}

function executionError<TState, TSignature>(
  phase: ExecutionPhase,
  stepId: string,
  cause: unknown,
  completed: readonly ExecutionReceipt<TState, TSignature>[],
  signature?: TSignature,
  logs?: readonly string[] | null,
): PlanExecutionError<TState, TSignature> {
  return new PlanExecutionError({
    phase,
    stepId,
    cause,
    signature,
    logs,
    completed: [...completed],
  });
}
