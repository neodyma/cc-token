import {
  CC_TOKEN_PROGRAM_ADDRESS,
  payoutRatio,
  validateScenarioName,
  type ConditionClause,
} from "@cc-token/sdk";
import { address, type Address, type Signature, type Slot } from "@solana/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Panel } from "./components.tsx";
import { describeError } from "./errors.ts";
import {
  ConditionInspector,
  Fractions,
  NodeActions,
  plainAmount,
  PositionInspector,
  WalletInspector,
  type Actions,
  type Resolutions,
} from "./Inspector.tsx";
import { balanceOf, COLLATERAL_KEY, layoutGraph, withPositionPath } from "./ledger.ts";
import {
  clearTakePositionCheckpoints,
  findOwnScenario,
  merge,
  mintTestCollateral,
  nameTestCollateral,
  prepareQuestion,
  publishScenario,
  redeem,
  registerCollateral,
  reportPayouts,
  split,
  takePosition,
  TEST_TOKEN_NAME,
  transfer,
  unwrap,
  wrap,
} from "./live/chain.ts";
import {
  fetchCollateral,
  fetchConditions,
  fetchHeldCollaterals,
  fetchPositions,
  ledgerFromPositions,
  positionsForScenario,
  recoverQuestion,
  whenCaughtUp,
  type ChainCondition,
  type LiveCollateral,
  type LivePosition,
} from "./live/discovery.ts";
import {
  loadQuestions,
  newQuestion,
  questionMemo,
  saveQuestions,
  toCondition,
  unnamedCondition,
  type StoredQuestion,
} from "./live/questions.ts";
import { PositionGraph, type GraphNode } from "./PositionGraph.tsx";
import { liveScenarioRoute, liveTokenRoute, ROUTES } from "./routes.ts";
import {
  attempt,
  boxLabel,
  describeClaim,
  findCondition,
  formatTokenAmount,
  holdingKey,
  MAX_U64,
  outcomesInIndexSet,
  parseTokenAmount,
  partitionSource,
  repetition,
  SCENARIOS,
  simulateRedemption,
  toHex,
  type DemoCondition,
} from "./scenario.ts";
import { Questions } from "./Simulator.tsx";
import { client, CLUSTER } from "./solana.ts";
import { showToast } from "./toast.tsx";

export const TEST_TOKEN = { symbol: "TEST", decimals: 6, grant: "1000" } as const;

// Everything this page remembers is scoped to the cluster and the deployed program.
export const STORAGE = `cc-token:live:${CLUSTER.chain}:${CC_TOKEN_PROGRAM_ADDRESS}`;

// The simulator's questions, offered as starting points.
export const EXAMPLE_QUESTIONS = [
  ...new Map(
    SCENARIOS.flatMap((scenario) => scenario.conditions).map((condition) => [
      `${condition.title}:${condition.outcomes.join()}`,
      { title: condition.title, outcomes: condition.outcomes },
    ]),
  ).values(),
];

type Selection =
  | Readonly<{ kind: "wallet" }>
  | Readonly<{ kind: "position"; key: string }>
  | Readonly<{ kind: "condition"; key: string }>;

type ChainState = Readonly<{
  collateral: LiveCollateral;
  positions: readonly LivePosition[];
  conditions: ReadonlyMap<string, ChainCondition>;
  wrappedChecked: boolean;
}>;

type Entry = Readonly<{ text: string; signatures: readonly Signature[] }>;

export function transactionLinks(signatures: readonly Signature[]) {
  return signatures.map((signature, index) => ({
    href: `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER.name}`,
    label: signatures.length > 1 ? `tx ${index + 1}` : "tx",
  }));
}

function shorten(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

type PendingAcquisition = Readonly<{ operationId: string; amount: string }>;

function loadPendingAcquisition(key: string | null): PendingAcquisition | null {
  if (key === null) return null;
  const stored = localStorage.getItem(key);
  if (stored === null) return null;
  const parsed = attempt(() => JSON.parse(stored) as unknown);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return null;
  const value = parsed.value as Record<string, unknown>;
  const amountText = String(value.amount);
  const amount = attempt(() => BigInt(amountText));
  return typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    value.operationId.length <= 128 &&
    /^\d+$/.test(amountText) &&
    amount.ok &&
    amount.value > 0n &&
    amount.value <= MAX_U64
    ? { operationId: value.operationId, amount: amountText }
    : null;
}

// A published scenario the workspace was opened for: its collateral token and the featured
// position, as the questions to split on in order.
export type ScenarioEntry = Readonly<{
  name: string;
  mint: Address;
  path: readonly ConditionClause[];
}>;

// The graph opens for a scenario or for a token named in the address bar. With neither, this
// only offers the tokens to open.
export function LiveWorkspace(props: {
  owner: Address;
  scenario?: ScenarioEntry;
  token?: Address;
}) {
  const { owner } = props;
  // The component is remounted for another scenario, so the first one stays for its lifetime.
  const scenario = useRef(props.scenario).current;
  const mintKey = `${STORAGE}:${owner}:mint`;
  const questionsKey = `${STORAGE}:questions`;

  const mint: Address | null = scenario?.mint ?? props.token ?? null;
  // Read by `refresh` right after a question is added, before React has re-rendered.
  const questions = useRef<readonly StoredQuestion[]>(loadQuestions(localStorage, questionsKey));
  const [chain, setChain] = useState<ChainState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly Entry[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "wallet" });

  // The slot of the latest transaction sent from here. Reads wait for it, because the public
  // endpoint is several nodes and one that is a little behind would show the old positions.
  const sentSlot = useRef<Slot | undefined>(undefined);
  // Questions whose published wording has already been looked for.
  const sought = useRef(new Set<string>());
  // How many questions on screen could not be looked up, so their wording may yet exist.
  const [unread, setUnread] = useState(0);
  async function noteSent(signatures: readonly Signature[]) {
    if (signatures.length === 0) return;
    const statuses = await client.rpc.getSignatureStatuses([...signatures]).send();
    for (const status of statuses.value) {
      if (status && (sentSlot.current === undefined || status.slot > sentSlot.current)) {
        sentSlot.current = status.slot;
      }
    }
  }

  const refresh = useCallback(
    async (target: Address) => {
      const config = sentSlot.current === undefined ? {} : { minContextSlot: sentSlot.current };
      const state = await whenCaughtUp(async () => {
        const [collateral, found, known] = await Promise.all([
          fetchCollateral(client.rpc, owner, target, config),
          fetchPositions(client.rpc, owner, target, config),
          fetchConditions(
            client.rpc,
            [
              ...questions.current.map((question) => toCondition(question).conditionId),
              // Shown even while the wallet holds nothing on them.
              ...(scenario?.path ?? []).map((factor) => factor.conditionId),
            ],
            config,
          ),
        ]);
        const positions = scenario
          ? positionsForScenario(scenario.path, found.positions)
          : found.positions;
        const basis = scenario
          ? new Set(scenario.path.map((factor) => toHex(factor.conditionId)))
          : null;
        return {
          collateral,
          positions,
          conditions: new Map(
            [...known, ...found.conditions].filter(([key]) => basis === null || basis.has(key)),
          ),
          wrappedChecked: found.wrappedChecked,
        };
      });
      setChain(state);

      // Positions on questions this browser never named, such as ones it was sent: look once
      // for the wording their resolver published.
      const named = new Set(questions.current.map((question) => toCondition(question).key));
      const unnamed = [...state.conditions].filter(
        ([key]) => !named.has(key) && !sought.current.has(key),
      );
      // One at a time, to stay within what the public endpoint allows. A lookup that failed
      // is not counted as done, so the next refresh tries it again.
      const found: StoredQuestion[] = [];
      let failed = 0;
      for (const [key, condition] of unnamed) {
        sought.current.add(key);
        try {
          const question = await recoverQuestion(client.rpc, condition);
          if (question) found.push(question);
        } catch {
          sought.current.delete(key);
          failed += 1;
        }
      }
      setUnread(failed);
      if (found.length === 0) return;
      questions.current = [...questions.current, ...found];
      saveQuestions(localStorage, questionsKey, questions.current);
      setChain({ ...state });
    },
    [owner, questionsKey, scenario],
  );

  useEffect(() => {
    if (!mint) return;
    let current = true;
    refresh(mint).catch((error) => current && setProblem(describeError(error)));
    return () => {
      current = false;
    };
  }, [mint, refresh]);

  // Sends, records what happened, and reads the chain again whether or not it worked: the
  // setup transactions of a failed action may still have landed.
  async function run(
    label: string,
    done: string,
    action: () => Promise<readonly Signature[]>,
    target: Address | null = mint,
  ) {
    setBusy(label);
    setProblem(null);
    // A plain re-read sends nothing, so it gets no toast.
    const toast =
      done === ""
        ? undefined
        : showToast({ tone: "pending", text: `${label}: approve it in your wallet.` });
    try {
      const signatures = await action();
      await noteSent(signatures);
      if (toast !== undefined) {
        setHistory((entries) => [...entries, { text: done, signatures }]);
        showToast({ tone: "good", text: done, links: transactionLinks(signatures) }, toast);
      }
    } catch (error) {
      const message = describeError(error);
      if (toast === undefined) setProblem(message);
      else showToast({ tone: "bad", text: `${label} did not go through. ${message}` }, toast);
    }
    try {
      if (target) await refresh(target);
    } catch (error) {
      setProblem(describeError(error));
    }
    setBusy(null);
  }

  // The token is part of the address, so choosing or leaving one is a change of page. The
  // last one opened is remembered as the default for a new scenario.
  function chooseMint(next: Address | null) {
    if (next) localStorage.setItem(mintKey, next);
    window.location.hash = next ? liveTokenRoute(next) : ROUTES.live;
  }

  const failure = problem && (
    <p className="rounded-md bg-bad-soft px-3 py-2 text-sm break-words text-bad">{problem}</p>
  );

  if (!mint) {
    return <HeldTokens owner={owner} onOpen={chooseMint} />;
  }

  if (!chain) {
    return (
      <Panel title="Positions">
        {failure ?? <p className="text-sm text-muted">Reading your positions from devnet…</p>}
        {failure && (
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              refresh(mint).catch((error: unknown) => setProblem(describeError(error)));
            }}
            className="mt-3 mr-4 text-sm text-accent underline"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => chooseMint(null)}
          className="mt-3 text-sm text-accent underline"
        >
          {scenario ? "All scenarios" : "Use another token"}
        </button>
      </Panel>
    );
  }

  return (
    <Workspace
      owner={owner}
      chain={chain}
      scenario={scenario}
      questions={questions.current}
      busy={busy}
      notice={
        <>
          {failure}
          {!chain.wrappedChecked && <WrappedUnchecked />}
          {unread > 0 && (
            <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
              Could not read the published wording of{" "}
              {unread === 1 ? "a question" : "some questions"}, so{" "}
              {unread === 1 ? "it shows" : "they show"} placeholder names. Refresh to try again.
            </p>
          )}
        </>
      }
      history={history}
      selection={selection}
      onSelect={(next) => {
        setSelection(next);
        setProblem(null);
      }}
      onFail={setProblem}
      onRun={run}
      onRefresh={() => void run("Reading devnet", "", async () => [])}
      onChangeToken={() => chooseMint(null)}
      onAddQuestion={(question) => {
        questions.current = [...questions.current, question];
        saveQuestions(localStorage, questionsKey, questions.current);
      }}
      onPublishScenario={async (name, factors, mode) => {
        const published: { address: Address | null } = { address: null };
        await run("Publishing the scenario", `Published the scenario “${name}”.`, async () => {
          const result = await publishScenario(client, chain.collateral.mint, name, factors, mode);
          published.address = result.address;
          return result.signatures;
        });
        if (published.address) window.location.hash = liveScenarioRoute(published.address);
      }}
    />
  );
}

// Shown when the scan of the wallet for wrapper tokens failed. Balances are read separately.
function WrappedUnchecked() {
  return (
    <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
      Could not check this wallet for wrapped positions, so any it holds are not shown. Refresh to
      try again.
    </p>
  );
}

// The tokens the wallet holds positions of, including ones it was only sent. This is the way
// to positions that belong to no published scenario. Nothing is shown to a wallet without any.
function HeldTokens(props: { owner: Address; onOpen: (mint: Address) => void }) {
  const [found, setFound] = useState<Awaited<ReturnType<typeof fetchHeldCollaterals>>>({
    collaterals: [],
    wrappedChecked: true,
  });
  useEffect(() => {
    let current = true;
    fetchHeldCollaterals(client.rpc, props.owner).then(
      (next) => current && setFound(next),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [props.owner]);

  if (found.collaterals.length === 0 && found.wrappedChecked) return null;
  return (
    <Panel
      title="Your positions"
      hint="Everything this wallet holds, by the token that backs it, including positions outside any scenario such as ones you were sent."
    >
      <ul className="flex flex-col gap-2">
        {found.collaterals.map(({ mint, positions, label }) => (
          <li key={mint}>
            <button
              type="button"
              onClick={() => props.onOpen(mint)}
              title={mint}
              className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent"
            >
              {label && <span className="font-medium">{label.symbol || label.name}</span>}
              <span className="font-mono text-xs text-muted">{shorten(mint)}</span>
              <span className="text-muted">
                {positions} {positions === 1 ? "position" : "positions"} backed by this token
              </span>
              <span className="ml-auto text-accent">Open as a graph</span>
            </button>
          </li>
        ))}
      </ul>
      {!found.wrappedChecked && (
        <div className="mt-3">
          <WrappedUnchecked />
        </div>
      )}
    </Panel>
  );
}

// The entry to a published scenario: what its featured position is, and one action that
// deposits and splits down to it.
function ScenarioBanner(props: {
  // Each question of the featured position with the results it pays on.
  legs: readonly Readonly<{ question: string; results: string }>[];
  symbol: string;
  decimals: number;
  free: bigint;
  held: bigint;
  mintable: boolean;
  busy: boolean;
  pendingAmount: bigint | null;
  completedSteps: number;
  onTake: (amount: bigint) => void;
  onFail: (message: string) => void;
}) {
  const { decimals, free } = props;
  const [text, setText] = useState(() => plainAmount(free, decimals));
  // Follow the balance until the amount is edited, since it arrives after the first render.
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setText(plainAmount(free, decimals));
  }, [free, decimals]);
  const pick = (next: string) => {
    edited.current = true;
    setText(next);
  };

  function submit() {
    const amount = attempt(() => parseTokenAmount(text, decimals));
    if (!amount.ok || amount.value <= 0n) return props.onFail("Enter an amount to deposit.");
    if (amount.value > free) {
      return props.onFail(
        `You have ${formatTokenAmount(free, decimals)} ${props.symbol} to deposit.`,
      );
    }
    props.onTake(amount.value);
  }

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-page p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-medium">This scenario's position pays if</span>
        {props.legs.map((leg, index) => (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted">and</span>}
            <span className="rounded-md border border-line bg-panel px-2 py-0.5">
              <span className="text-muted">{leg.question}: </span>
              <span className="font-medium">{leg.results}</span>
            </span>
          </span>
        ))}
        {props.held > 0n && (
          <span className="ml-auto text-good">
            You hold {formatTokenAmount(props.held, decimals)} shares
          </span>
        )}
      </div>
      {props.pendingAmount !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="mr-auto text-muted">
            Resume the {formatTokenAmount(props.pendingAmount, decimals)} {props.symbol} deposit.
            Confirmed splits are checked before another transaction is sent.
            {props.completedSteps > 0
              ? ` ${props.completedSteps} of ${props.legs.length} steps confirmed.`
              : ""}
          </p>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onTake(props.pendingAmount!)}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
          >
            Resume position
          </button>
        </div>
      ) : free === 0n && props.held > 0n ? null : free === 0n ? (
        <p className="mt-2 text-muted">
          You have no {props.symbol} to deposit.{" "}
          {props.mintable
            ? "Mint some above."
            : "Its issuer has to send you some, or another wallet can send you positions."}
        </p>
      ) : (
        <>
          <fieldset
            disabled={props.busy}
            className="m-0 mt-3 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
          >
            <span className="text-muted">Deposit</span>
            <input
              value={text}
              onChange={(event) => pick(event.target.value)}
              inputMode="decimal"
              aria-label={`Amount of ${props.symbol} to deposit`}
              className="w-32 rounded-md border border-line bg-panel px-2 py-1.5 font-mono"
            />
            <span className="text-muted">{props.symbol}</span>
            <div className="w-44 [&>div]:mt-0">
              <Fractions max={free} decimals={decimals} onPick={pick} />
            </div>
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
            >
              Get this position
            </button>
          </fieldset>
          <p className="mt-2 text-xs text-muted">
            You get one share of it for each {props.symbol} deposited, with one confirmed split per
            question. New position accounts can require additional setup approvals. The same number
            of shares on the other results comes with it and stays in your graph, to send, wrap or
            merge back. To pick other results yourself, use the split button under your wallet.
          </p>
        </>
      )}
    </div>
  );
}

function Workspace(props: {
  owner: Address;
  chain: ChainState;
  scenario: ScenarioEntry | undefined;
  questions: readonly StoredQuestion[];
  busy: string | null;
  notice: ReactNode;
  history: readonly Entry[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onFail: (message: string) => void;
  onRun: (
    label: string,
    done: string,
    action: () => Promise<readonly Signature[]>,
  ) => Promise<void>;
  onRefresh: () => void;
  onChangeToken: () => void;
  onAddQuestion: (question: StoredQuestion) => void;
  onPublishScenario: (
    name: string,
    factors: readonly ConditionClause[],
    mode: "logical" | "product",
  ) => Promise<void>;
}) {
  const { owner, chain, selection, scenario } = props;
  const { collateral } = chain;
  const { decimals } = collateral;
  // The token's own symbol when it has one; an unnamed token made here is still "TEST" to its
  // maker, and anything else falls back to its address.
  const symbol =
    collateral.label?.symbol ||
    (collateral.mintable ? TEST_TOKEN.symbol : shorten(collateral.mint));
  const display = { symbol, mint: collateral.mint, decimals };
  const amountOf = (amount: bigint) => formatTokenAmount(amount, decimals);
  const tokens = (amount: bigint) => `${amountOf(amount)} ${symbol}`;

  // A question is not tied to a token, so every one this browser knows could be used here.
  // The list starts with those the positions use; others are put on it when asked for.
  const [shown, setShown] = useState<readonly string[]>([]);
  const show = (key: string) =>
    setShown((current) => (current.includes(key) ? current : [...current, key]));
  const inUse = useMemo(
    () =>
      new Set(
        chain.positions
          .filter((position) => position.amount > 0n || position.wrapped > 0n)
          .flatMap((position) => position.factors.map((factor) => toHex(factor.conditionId))),
      ),
    [chain.positions],
  );
  function hide(key: string) {
    setShown((current) => current.filter((candidate) => candidate !== key));
    if (selection.kind === "condition" && selection.key === key) {
      props.onSelect({ kind: "wallet" });
    }
  }

  // Questions this browser named and that exist on-chain, then any others found in positions.
  const known = useMemo(() => {
    const named = props.questions
      .map(toCondition)
      .filter((condition) => chain.conditions.has(condition.key));
    const keys = new Set(named.map((condition) => condition.key));
    const others = [...chain.conditions.values()]
      .map(unnamedCondition)
      .filter((condition) => !keys.has(condition.key));
    return [...named, ...others];
  }, [props.questions, chain.conditions]);
  // On the list: the questions of held positions, a scenario's own, and those asked for.
  const conditions = useMemo(() => {
    const featured = new Set(scenario?.path.map((factor) => toHex(factor.conditionId)));
    return known.filter(
      (condition) =>
        inUse.has(condition.key) || featured.has(condition.key) || shown.includes(condition.key),
    );
  }, [known, inUse, scenario, shown]);
  const resolutions: Resolutions = useMemo(
    () =>
      Object.fromEntries(
        [...chain.conditions].flatMap(([key, condition]) =>
          condition.payouts ? [[key, condition.payouts]] : [],
        ),
      ),
    [chain.conditions],
  );
  const ledger = useMemo(() => {
    const held = ledgerFromPositions(collateral.free, chain.positions);
    return scenario ? withPositionPath(held, scenario.path) : held;
  }, [collateral.free, chain.positions, scenario]);
  const layout = useMemo(() => layoutGraph(ledger), [ledger]);
  const wrapped = useMemo(
    () =>
      new Map(
        chain.positions.map((position) => [
          holdingKey(position.factors),
          { amount: position.wrapped, mint: position.wrapperMint },
        ]),
      ),
    [chain.positions],
  );

  const selectedNode =
    selection.kind === "position"
      ? (ledger.nodes.find((node) => node.key === selection.key) ?? null)
      : null;
  const selectedFactors = selectedNode?.factors;
  const [ownScenario, setOwnScenario] = useState<Readonly<{
    key: string;
    name: string;
    href: string;
  }> | null>(null);
  useEffect(() => {
    if (!selectedFactors) return;
    let current = true;
    const key = holdingKey(selectedFactors);
    findOwnScenario(client.rpc, owner, collateral.mint, selectedFactors).then(
      (found) =>
        current &&
        setOwnScenario(found && { key, name: found.name, href: liveScenarioRoute(found.address) }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [selectedFactors, owner, collateral.mint]);
  const published = selectedNode && ownScenario?.key === selectedNode.key ? ownScenario : null;
  // The position a scenario page is about is published already, whoever is looking.
  const isFeatured =
    scenario !== undefined &&
    selectedNode !== null &&
    selectedNode.key === holdingKey(scenario.path);

  const selectedCondition =
    selection.kind === "condition"
      ? (conditions.find((condition) => condition.key === selection.key) ?? null)
      : null;

  const nameOf = (factors: readonly ConditionClause[]) => describeClaim(conditions, factors);
  const resolved = (factor: ConditionClause) =>
    resolutions[findCondition(conditions, factor.conditionId).key];
  const payoutOf = (factors: readonly ConditionClause[], amount: bigint): bigint => {
    const steps = simulateRedemption(
      factors,
      (conditionId) => resolutions[findCondition(conditions, conditionId).key]!,
      amount,
    );
    return steps[steps.length - 1]!.output;
  };

  // Offered when each question of the featured position appears once, so that it is reached
  // by one split per question.
  const featuredPath =
    scenario &&
    repetition(scenario.path) === "none" &&
    scenario.path.every((factor) =>
      conditions.some((condition) => condition.key === toHex(factor.conditionId)),
    )
      ? scenario.path
      : null;
  const acquisitionKey =
    scenario === undefined
      ? null
      : `${STORAGE}:${owner}:take:${collateral.mint}:${holdingKey(scenario.path)}`;
  const checkpointPrefix = `${STORAGE}:take-checkpoint:`;
  const [pendingAcquisition, setPendingAcquisition] = useState<PendingAcquisition | null>(() =>
    loadPendingAcquisition(acquisitionKey),
  );
  const [completedAcquisitionSteps, setCompletedAcquisitionSteps] = useState(0);
  function takeFeatured(path: readonly ConditionClause[], amount: bigint) {
    if (acquisitionKey === null) return;
    const pending = pendingAcquisition ?? {
      operationId: crypto.randomUUID(),
      amount: amount.toString(),
    };
    if (pendingAcquisition === null) {
      const stored = attempt(() => localStorage.setItem(acquisitionKey, JSON.stringify(pending)));
      if (!stored.ok) {
        props.onFail("This browser could not save the acquisition before it starts.");
        return;
      }
      setPendingAcquisition(pending);
    }
    const deposit = BigInt(pending.amount);
    void props.onRun(
      "Taking the position",
      `Deposited ${tokens(deposit)} and split it down to ${nameOf(path)}.`,
      async () => {
        const signatures = await takePosition(client, collateral, path, deposit, {
          operationId: pending.operationId,
          storage: localStorage,
          checkpointPrefix,
          onStep: (completed) => setCompletedAcquisitionSteps(completed),
        });
        localStorage.removeItem(acquisitionKey);
        setPendingAcquisition(null);
        setCompletedAcquisitionSteps(0);
        await clearTakePositionCheckpoints(owner, collateral.mint, path, deposit, {
          operationId: pending.operationId,
          storage: localStorage,
          checkpointPrefix,
        });
        return signatures;
      },
    );
    props.onSelect({ kind: "position", key: holdingKey(path) });
  }

  const actions: Actions = {
    split: (parent, condition, partition, amount) => {
      const source = partitionSource(parent, condition, partition);
      const title = findCondition(conditions, condition.conditionId).title;
      void props.onRun(
        source.length === 0 ? "Depositing" : "Splitting",
        source.length === 0
          ? `Deposited ${tokens(amount)} on “${title}” and received ${amountOf(amount)} shares of each piece.`
          : `Split ${amountOf(amount)} shares of ${nameOf(source)} on “${title}”.`,
        () => split(client, collateral, parent, condition, partition, amount),
      );
    },
    merge: (option) =>
      void props.onRun(
        "Merging",
        option.result.length === 0
          ? `Merged a full set and unlocked ${tokens(option.amount)}.`
          : `Merged ${amountOf(option.amount)} shares back into ${nameOf(option.result)}.`,
        () =>
          merge(
            client,
            collateral,
            option.parent,
            option.condition,
            option.partition,
            option.amount,
          ),
      ),
    // There is no venue on-chain: positions are acquired by depositing and splitting.
    trade: () => {},
    wrap: (key, amount) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key);
      if (!node) return;
      void props.onRun(
        "Wrapping",
        `Wrapped ${amountOf(amount)} shares of ${nameOf(node.factors)} as a token.`,
        () => wrap(client, collateral, node.factors, amount),
      );
    },
    transfer: (key, to, amount) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key);
      if (!node) return;
      const recipient = attempt(() => address(to));
      if (!recipient.ok) return props.onFail("That is not a wallet address.");
      if (recipient.value === owner) return props.onFail("That is your own wallet.");
      void props.onRun(
        "Sending",
        `Sent ${amountOf(amount)} shares of ${nameOf(node.factors)} to ${shorten(recipient.value)}.`,
        () => transfer(client, collateral, node.factors, recipient.value, amount),
      );
    },
    publish: (key, name) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key);
      if (!node) return;
      const valid = attempt(() => validateScenarioName(name));
      if (!valid.ok) {
        return props.onFail(
          "A scenario name is 1 to 64 bytes, without line breaks or surrounding spaces.",
        );
      }
      // A question used twice only means something as an explicit product.
      const mode = repetition(node.factors) === "none" ? "logical" : "product";
      void props.onPublishScenario(name, node.factors, mode);
    },
    unwrap: (key, amount) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key);
      if (!node) return;
      void props.onRun(
        "Unwrapping",
        `Unwrapped ${amountOf(amount)} shares of ${nameOf(node.factors)}.`,
        () => unwrap(client, collateral, node.factors, amount),
      );
    },
    redeem: (key, factorIndex) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key);
      if (!node) return;
      const held = balanceOf(ledger, key);
      const title = findCondition(conditions, node.factors[factorIndex]!.conditionId).title;
      void props.onRun(
        "Redeeming",
        `Redeemed ${amountOf(held)} shares of ${nameOf(node.factors)} on “${title}”.`,
        () => redeem(client, collateral, node.factors, factorIndex, held),
      );
    },
    report: (conditionKey, numerators) => {
      const condition = conditions.find((candidate) => candidate.key === conditionKey);
      if (!condition) return;
      void props.onRun("Reporting the result", `Reported the result of “${condition.title}”.`, () =>
        reportPayouts(client, condition.conditionId, numerators),
      );
    },
    fail: props.onFail,
  };

  function addQuestion(title: string, outcomes: readonly string[]): string | null {
    if (title === "") return "Give the question a name.";
    if (outcomes.length < 2) return "List at least two possible results, separated by commas.";
    if (new Set(outcomes).size < outcomes.length) return "Each result needs a different name.";
    if (outcomes.length > 96) return "This page handles at most 96 results per question.";
    const question = newQuestion(owner, title, outcomes, crypto.randomUUID());
    const condition = toCondition(question);
    void props.onRun(
      "Preparing the question",
      `Prepared the question “${title}” with the possible results ${outcomes.join(", ")}.`,
      async () => {
        const signatures = await prepareQuestion(
          client,
          condition.questionId,
          outcomes.length,
          questionMemo(question),
        );
        props.onAddQuestion(question);
        show(condition.key);
        props.onSelect({ kind: "condition", key: condition.key });
        return signatures;
      },
    );
    return null;
  }

  const graphNodes: GraphNode[] = [
    {
      key: COLLATERAL_KEY,
      context: `Your wallet · ${shorten(owner)}`,
      title: `Free ${symbol}`,
      amount: amountOf(collateral.free),
      empty: collateral.free === 0n,
      wallet: true,
    },
    ...ledger.nodes.map((node) => {
      const held = balanceOf(ledger, node.key);
      const inToken = wrapped.get(node.key)?.amount ?? 0n;
      const settled = node.factors.every(resolved);
      const payout = settled && held > 0n ? payoutOf(node.factors, held) : null;
      const redeemable = held > 0n && node.factors.some(resolved);
      const highlight =
        payout !== null
          ? payout > 0n
            ? "Pays out"
            : "Pays nothing"
          : redeemable
            ? "Redeem"
            : null;
      return {
        key: node.key,
        ...boxLabel(conditions, node.factors),
        amount:
          inToken > 0n
            ? `${amountOf(held)} sh + ${amountOf(inToken)} wrapped`
            : `${amountOf(held)} sh`,
        detail:
          payout !== null
            ? `pays ${amountOf(payout)}`
            : settled
              ? `pays ${node.factors
                  .reduce((value, factor) => {
                    const ratio = payoutRatio(resolved(factor)!, factor.indexSet);
                    return (value * Number(ratio.numerator)) / Number(ratio.denominator);
                  }, 1)
                  .toFixed(2)} each`
              : "",
        empty: held === 0n && inToken === 0n,
        ...(payout === null ? {} : { tone: payout > 0n ? ("win" as const) : ("lose" as const) }),
        ...(highlight ? { highlight } : {}),
      };
    }),
  ];

  const { publish: _publish, ...withoutPublish } = actions;
  const workspace = {
    collateral: display,
    conditions,
    ledger,
    market: null,
    marketOpen: false,
    wrapped,
    resolutions,
    published,
    actions: isFeatured ? withoutPublish : actions,
  };

  if (!collateral.registered) {
    return (
      <Panel
        title="Register the token"
        hint={`${collateral.mint} is not registered as collateral yet. Anyone can register a token once; it creates the vault that holds deposits.`}
      >
        <fieldset disabled={props.busy !== null} className="m-0 min-w-0 border-0 p-0">
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              onClick={() =>
                void props.onRun(
                  "Registering the token",
                  "Registered the token as collateral.",
                  () => registerCollateral(client, collateral),
                )
              }
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
            >
              Register it
            </button>
            <button type="button" onClick={props.onChangeToken} className="text-accent underline">
              Use another token
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2">{props.notice}</div>
        </fieldset>
      </Panel>
    );
  }

  return (
    // A disabled fieldset disables every control inside while a transaction is pending.
    <fieldset
      disabled={props.busy !== null}
      className="m-0 grid min-w-0 grid-cols-1 items-start gap-4 border-0 p-0 xl:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <section className="min-w-0 rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span>
            <span className="text-muted">Collateral</span>{" "}
            <span className="font-medium">{symbol}</span>{" "}
            {collateral.label?.name && <span className="text-muted">{collateral.label.name} </span>}
            <span className="font-mono text-xs text-muted" title={collateral.mint}>
              {shorten(collateral.mint)}
            </span>
          </span>
          {collateral.issuerControlled && (
            <span className="text-muted" title="Deposits made here opt in to that risk.">
              Its issuer can freeze accounts.
            </span>
          )}
          <span className="ml-auto flex gap-4">
            {collateral.mintable && (
              <button
                type="button"
                onClick={() =>
                  void props.onRun("Minting", `Minted ${TEST_TOKEN.grant} more ${symbol}.`, () =>
                    mintTestCollateral(
                      client,
                      collateral,
                      parseTokenAmount(TEST_TOKEN.grant, decimals),
                    ),
                  )
                }
                className="text-accent underline"
              >
                Mint {TEST_TOKEN.grant} more
              </button>
            )}
            {collateral.mintable && !collateral.label && (
              <button
                type="button"
                title="Adds a name and symbol that other wallets and explorers show instead of the address"
                onClick={() =>
                  void props.onRun(
                    "Naming the token",
                    `Named the token “${TEST_TOKEN_NAME.name}” (${TEST_TOKEN_NAME.symbol}).`,
                    () => nameTestCollateral(client, collateral),
                  )
                }
                className="text-accent underline"
              >
                Name this token
              </button>
            )}
            <button type="button" onClick={props.onRefresh} className="text-accent underline">
              Refresh
            </button>
            <button type="button" onClick={props.onChangeToken} className="text-accent underline">
              {scenario ? "All scenarios" : "Use another token"}
            </button>
          </span>
        </div>

        {scenario && featuredPath && (
          <ScenarioBanner
            legs={featuredPath.map((factor) => {
              const condition = findCondition(conditions, factor.conditionId);
              return {
                question: condition.title,
                results: outcomesInIndexSet(factor.indexSet, factor.outcomeCount)
                  .map((outcome) => condition.outcomes[outcome]!)
                  .join(" or "),
              };
            })}
            symbol={symbol}
            decimals={decimals}
            free={collateral.registered ? collateral.free : 0n}
            held={
              chain.positions.find(
                (position) => holdingKey(position.factors) === holdingKey(featuredPath),
              )?.amount ?? 0n
            }
            mintable={collateral.mintable}
            busy={props.busy !== null}
            pendingAmount={pendingAcquisition === null ? null : BigInt(pendingAcquisition.amount)}
            completedSteps={completedAcquisitionSteps}
            onTake={(amount) => takeFeatured(featuredPath, amount)}
            onFail={props.onFail}
          />
        )}

        <Questions
          conditions={conditions}
          resolutions={resolutions}
          selectedKey={selectedCondition?.key ?? null}
          onSelect={(key) => props.onSelect({ kind: "condition", key })}
          // A published scenario has its questions; others are prepared on the Live page.
          {...(scenario
            ? {}
            : {
                onAdd: addQuestion,
                more: known
                  .filter((condition) => !conditions.includes(condition))
                  .map(({ key, title, outcomes }) => ({ key, title, outcomes: outcomes.length })),
                onShow: show,
              })}
          examples={EXAMPLE_QUESTIONS}
          removable={(key) => !scenario && !inUse.has(key)}
          onRemove={hide}
        />

        <PositionGraph
          nodes={graphNodes}
          edges={ledger.edges}
          layout={layout}
          selectedKey={
            selectedNode ? selectedNode.key : selection.kind === "condition" ? "" : COLLATERAL_KEY
          }
          toolbar={
            selection.kind === "condition" || conditions.length === 0 ? null : (
              <NodeActions
                key={`${selectedNode?.key ?? COLLATERAL_KEY}:${selectedNode ? balanceOf(ledger, selectedNode.key) : collateral.free}`}
                {...workspace}
                node={selectedNode}
              />
            )
          }
          onSelect={(key) =>
            props.onSelect(key === COLLATERAL_KEY ? { kind: "wallet" } : { kind: "position", key })
          }
        />

        <p className="mt-3 text-xs text-muted">
          {conditions.length === 0
            ? "Prepare a question first, then select your wallet in the graph to deposit. "
            : "Read from the program's accounts on devnet; every action is a real transaction. "}
          There is no market here: positions come from depositing and splitting, and can be wrapped
          as ordinary tokens to move or trade elsewhere. Positions sent to this wallet show up here
          too. A question's wording is published with it, so other wallets see the same names.{" "}
          <a href={ROUTES.simulator} className="text-accent underline">
            Try it in the simulator first
          </a>
        </p>
      </section>

      <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-18 xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
        {props.notice}
        {selectedCondition ? (
          <ConditionInspector
            key={selectedCondition.key}
            {...workspace}
            condition={selectedCondition}
            example={undefined}
            exampleNote=""
            {...(selectedCondition.resolver === owner
              ? {}
              : {
                  locked: `Only its resolver, ${shorten(selectedCondition.resolver)}, can report this result.`,
                })}
          />
        ) : selectedNode ? (
          <PositionInspector
            key={selectedNode.key}
            {...workspace}
            node={selectedNode}
            origin="Read from your balance accounts on devnet. The graph draws it under the position it can be cut from."
          />
        ) : (
          <WalletInspector {...workspace} />
        )}
        <section className="rounded-xl border border-line bg-panel p-4 text-sm">
          <h2 className="flex items-baseline justify-between font-medium">
            Activity
            <span className="text-xs font-normal text-muted">
              {props.history.length === 0 ? "nothing sent yet" : "newest first"}
            </span>
          </h2>
          {props.history.length > 0 && (
            <ol className="mt-2 flex max-h-56 flex-col overflow-y-auto text-xs [scrollbar-width:thin]">
              {[...props.history].reverse().map((entry, index) => {
                const cut = entry.text.indexOf(" ");
                return (
                  <li
                    key={props.history.length - index}
                    className="flex items-baseline gap-2 border-t border-line py-1.5 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-muted" title={entry.text}>
                      <span className="font-medium text-ink">{entry.text.slice(0, cut)}</span>
                      {entry.text.slice(cut).replace(/\.$/, "")}
                    </span>
                    {transactionLinks(entry.signatures).map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in the explorer"
                        className="shrink-0 text-accent hover:underline"
                      >
                        {link.label} ↗
                      </a>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </fieldset>
  );
}
