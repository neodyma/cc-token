import {
  CC_TOKEN_PROGRAM_ADDRESS,
  generatedClient,
  payoutRatio,
  type ConditionClause,
} from "@cc-token/sdk";
import {
  address,
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  type Address,
  type Signature,
  type Slot,
} from "@solana/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Panel } from "./components.tsx";
import {
  ConditionInspector,
  NodeActions,
  PositionInspector,
  WalletInspector,
  type Actions,
  type Resolutions,
} from "./Inspector.tsx";
import { balanceOf, COLLATERAL_KEY, layoutGraph } from "./ledger.ts";
import {
  createTestCollateral,
  merge,
  mintTestCollateral,
  nameTestCollateral,
  prepareQuestion,
  redeem,
  registerCollateral,
  reportPayouts,
  split,
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
import { ROUTES } from "./routes.ts";
import {
  attempt,
  boxLabel,
  describeClaim,
  findCondition,
  formatTokenAmount,
  holdingKey,
  parseTokenAmount,
  partitionSource,
  SCENARIOS,
  simulateRedemption,
  toHex,
  type DemoCondition,
} from "./scenario.ts";
import { Questions } from "./Simulator.tsx";
import { client, CLUSTER } from "./solana.ts";
import { showToast } from "./toast.tsx";

const TEST_TOKEN = { symbol: "TEST", decimals: 6, grant: "1000" } as const;

// Everything this page remembers is scoped to the cluster and the deployed program.
const STORAGE = `cc-token:live:${CLUSTER.chain}:${CC_TOKEN_PROGRAM_ADDRESS}`;

const HIDDEN_KEY = `${STORAGE}:hidden-questions`;

// The simulator's questions, offered as starting points.
const EXAMPLE_QUESTIONS = [
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

function transactionLinks(signatures: readonly Signature[]) {
  return signatures.map((signature, index) => ({
    href: `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER.name}`,
    label: signatures.length > 1 ? `tx ${index + 1}` : "tx",
  }));
}

function shorten(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function describeError(error: unknown): string {
  let message = String(error);
  for (let current = error; current instanceof Error; current = current.cause) {
    message = current.message;
    if (isSolanaError(current, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      const { code } = current.context;
      // Messages are left out of production bundles, so the code is always shown.
      const known =
        code >= 6000 && process.env.NODE_ENV !== "production"
          ? generatedClient.getCcTokenErrorMessage(code as generatedClient.CcTokenError)
          : undefined;
      return `The program refused with error ${code}${known ? `: ${known}` : ""}.`;
    }
  }
  return message;
}

export function LiveWorkspace(props: { owner: Address }) {
  const { owner } = props;
  const mintKey = `${STORAGE}:${owner}:mint`;
  const questionsKey = `${STORAGE}:questions`;

  const [mint, setMint] = useState<Address | null>(
    () => (localStorage.getItem(mintKey) as Address | null) ?? null,
  );
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
            questions.current.map((question) => toCondition(question).conditionId),
            config,
          ),
        ]);
        return {
          collateral,
          positions: found.positions,
          conditions: new Map([...known, ...found.conditions]),
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
      if (unnamed.length === 0) return;
      const recovered = await Promise.all(
        unnamed.map(([key, condition]) => {
          sought.current.add(key);
          return recoverQuestion(client.rpc, condition).catch(() => null);
        }),
      );
      const found = recovered.filter((question) => question !== null);
      if (found.length === 0) return;
      questions.current = [...questions.current, ...found];
      saveQuestions(localStorage, questionsKey, questions.current);
      setChain({ ...state });
    },
    [owner, questionsKey],
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

  function chooseMint(next: Address | null) {
    if (next) localStorage.setItem(mintKey, next);
    else localStorage.removeItem(mintKey);
    setChain(null);
    setSelection({ kind: "wallet" });
    setMint(next);
  }

  function createToken() {
    const amount = parseTokenAmount(TEST_TOKEN.grant, TEST_TOKEN.decimals);
    const done = `Created a test token, minted ${TEST_TOKEN.grant} of it and registered it as collateral.`;
    void (async () => {
      setBusy("Creating a test token");
      setProblem(null);
      const toast = showToast({
        tone: "pending",
        text: "Creating a test token: approve it in your wallet.",
      });
      try {
        const created = await createTestCollateral(client, amount, TEST_TOKEN.decimals);
        await noteSent(created.signatures);
        setHistory((entries) => [...entries, { text: done, signatures: created.signatures }]);
        showToast({ tone: "good", text: done, links: transactionLinks(created.signatures) }, toast);
        chooseMint(created.mint);
      } catch (error) {
        showToast(
          { tone: "bad", text: `The token was not created. ${describeError(error)}` },
          toast,
        );
      }
      setBusy(null);
    })();
  }

  const failure = problem && (
    <p className="rounded-md bg-bad-soft px-3 py-2 text-sm break-words text-bad">{problem}</p>
  );

  if (!mint) {
    return (
      <Setup
        owner={owner}
        busy={busy !== null}
        notice={failure}
        onCreate={createToken}
        onUse={(text) => {
          const parsed = attempt(() => address(text.trim()));
          if (parsed.ok) chooseMint(parsed.value);
          else setProblem("That is not a token address.");
        }}
      />
    );
  }

  if (!chain) {
    return (
      <Panel title="Positions">
        {failure ?? <p className="text-sm text-muted">Reading your positions from devnet…</p>}
        <button
          type="button"
          onClick={() => chooseMint(null)}
          className="mt-3 text-sm text-accent underline"
        >
          Use another token
        </button>
      </Panel>
    );
  }

  return (
    <Workspace
      owner={owner}
      chain={chain}
      questions={questions.current}
      busy={busy}
      notice={
        <>
          {failure}
          {!chain.wrappedChecked && <WrappedUnchecked />}
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

function Setup(props: {
  owner: Address;
  busy: boolean;
  notice: ReactNode;
  onCreate: () => void;
  onUse: (mint: string) => void;
}) {
  const [text, setText] = useState("");
  // Collateral tokens the wallet already has positions of, including ones it was only sent.
  const [found, setFound] = useState<Awaited<ReturnType<typeof fetchHeldCollaterals>>>({
    collaterals: [],
    wrappedChecked: true,
  });
  const held = found.collaterals;
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

  return (
    <Panel
      title="Choose a collateral token"
      hint="Positions are backed by a token locked in the program's vault. On devnet the simplest choice is a throwaway token that your wallet can mint."
    >
      <fieldset disabled={props.busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        {held.length > 0 && (
          <div>
            <p className="text-sm font-medium">This wallet already holds positions</p>
            <ul className="mt-2 flex flex-col gap-2">
              {held.map(({ mint, positions, label }) => (
                <li key={mint}>
                  <button
                    type="button"
                    onClick={() => props.onUse(mint)}
                    title={mint}
                    className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent"
                  >
                    {label && <span className="font-medium">{label.symbol || label.name}</span>}
                    <span className="font-mono text-xs text-muted">{shorten(mint)}</span>
                    <span className="text-muted">
                      {positions} {positions === 1 ? "position" : "positions"} backed by this token
                    </span>
                    <span className="ml-auto text-accent">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={props.onCreate}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40"
          >
            Create a test token
          </button>
          <p className="mt-1 text-sm text-muted">
            One transaction: creates the token, mints {TEST_TOKEN.grant} {TEST_TOKEN.symbol} to your
            wallet and registers it as collateral. It costs a little devnet SOL in rent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="or paste the address of a token you hold"
            aria-label="Token mint address"
            className="min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 font-mono"
          />
          <button
            type="button"
            disabled={text.trim() === ""}
            onClick={() => props.onUse(text)}
            className="rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            Use this token
          </button>
        </div>
        {props.notice}
        {!found.wrappedChecked && <WrappedUnchecked />}
      </fieldset>
    </Panel>
  );
}

function Workspace(props: {
  owner: Address;
  chain: ChainState;
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
}) {
  const { owner, chain, selection } = props;
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

  // Questions cannot be deleted on-chain, only taken off this list. One that a held position
  // uses always shows.
  const [hidden, setHidden] = useState<readonly string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
      return Array.isArray(stored) ? (stored as string[]) : [];
    } catch {
      return [];
    }
  });
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
    const next = [...hidden, key];
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    setHidden(next);
    if (selection.kind === "condition" && selection.key === key) {
      props.onSelect({ kind: "wallet" });
    }
  }

  // Questions this browser named and that exist on-chain, then any others found in positions.
  const conditions = useMemo(() => {
    const named = props.questions
      .map(toCondition)
      .filter((condition) => chain.conditions.has(condition.key));
    const keys = new Set(named.map((condition) => condition.key));
    const others = [...chain.conditions.values()]
      .map(unnamedCondition)
      .filter((condition) => !keys.has(condition.key));
    return [...named, ...others].filter(
      (condition) => inUse.has(condition.key) || !hidden.includes(condition.key),
    );
  }, [props.questions, chain.conditions, hidden, inUse]);
  const resolutions: Resolutions = useMemo(
    () =>
      Object.fromEntries(
        [...chain.conditions].flatMap(([key, condition]) =>
          condition.payouts ? [[key, condition.payouts]] : [],
        ),
      ),
    [chain.conditions],
  );
  const ledger = useMemo(
    () => ledgerFromPositions(collateral.free, chain.positions),
    [collateral.free, chain.positions],
  );
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

  const workspace = {
    collateral: display,
    conditions,
    ledger,
    market: null,
    marketOpen: false,
    wrapped,
    resolutions,
    actions,
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
              Use another token
            </button>
          </span>
        </div>

        <Questions
          conditions={conditions}
          resolutions={resolutions}
          selectedKey={selectedCondition?.key ?? null}
          onSelect={(key) => props.onSelect({ kind: "condition", key })}
          onAdd={addQuestion}
          examples={EXAMPLE_QUESTIONS}
          removable={(key) => !inUse.has(key)}
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
