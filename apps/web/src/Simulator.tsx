import {
  complementIndexSet,
  payoutRatio,
  type ConditionClause,
  type IndexSetWords,
} from "@cc-token/sdk";
import { useMemo, useState } from "react";

import {
  ConditionInspector,
  NodeActions,
  PositionInspector,
  WalletInspector,
  type Actions,
  type Resolutions,
} from "./Inspector.tsx";
import {
  balanceOf,
  COLLATERAL_KEY,
  layoutGraph,
  merge,
  openLedger,
  redeem,
  redemption,
  split,
  trade,
  type Ledger,
} from "./ledger.ts";
import { claimAtoms, extendMarket, openMarket, price, type Market } from "./market.ts";
import { PositionGraph, type GraphNode } from "./PositionGraph.tsx";
import { ROUTES } from "./routes.ts";
import {
  attempt,
  boxLabel,
  claimStatement,
  compose,
  defineCondition,
  describeClaim,
  findCondition,
  formatTokenAmount,
  holdingKey,
  parseTokenAmount,
  partitionSource,
  SCENARIOS,
  simulateRedemption,
  toHex,
  type ConditionRef,
  type DemoCondition,
  type Scenario,
} from "./scenario.ts";

// The simulated market prices every combination of results, so their number has to stay small.
const MAX_COMBINATIONS = 2048;

type Selection =
  | Readonly<{ kind: "wallet" }>
  | Readonly<{ kind: "position"; key: string }>
  | Readonly<{ kind: "condition"; key: string }>;

export function Simulator() {
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.key);
  const scenario = SCENARIOS.find((candidate) => candidate.key === scenarioKey)!;

  return <Workspace key={scenario.key} scenario={scenario} onSelectScenario={setScenarioKey} />;
}

function toNumber(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function Workspace(props: { scenario: Scenario; onSelectScenario: (key: string) => void }) {
  const { scenario } = props;
  const { collateral } = scenario;
  const { symbol, decimals } = collateral;
  const tokens = (amount: bigint) => `${formatTokenAmount(amount, decimals)} ${symbol}`;

  const start = useMemo(() => {
    const deposit = parseTokenAmount(scenario.deposit, decimals);
    const wallet = 2n * deposit;
    const { factors } = compose(
      scenario.conditions,
      scenario.factors,
      scenario.mode,
      collateral.mint,
    ).plan;
    return {
      deposit,
      wallet,
      exampleKey: holdingKey(factors),
      example: openLedger(wallet, factors, deposit),
      // The example's own deposit, told the same way as the user's later actions.
      story: factors.map((factor, index) =>
        describeSplit(
          scenario.conditions,
          collateral,
          factors.slice(0, index),
          factor,
          [factor.indexSet, complementIndexSet(factor.outcomeCount, factor.indexSet)],
          deposit,
        ),
      ),
      empty: openLedger(wallet, [], 0n),
      market: openMarket(scenario.conditions, scenario.odds, toNumber(wallet, decimals)),
    };
  }, [scenario, collateral, decimals]);

  const [customs, setCustoms] = useState<readonly DemoCondition[]>([]);
  const [ledger, setLedger] = useState<Ledger>(start.example);
  const [market, setMarket] = useState<Market>(start.market);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  // The positions as they were when the first result came in, to go back to.
  const [unresolved, setUnresolved] = useState<Readonly<{
    ledger: Ledger;
    history: readonly string[];
  }> | null>(null);
  // What has been done so far, one plain sentence per action.
  const [history, setHistory] = useState<readonly string[]>(start.story);
  const log = (sentence: string) => setHistory((current) => [...current, sentence]);
  const [selection, setSelection] = useState<Selection>({
    kind: "position",
    key: start.exampleKey,
  });
  const [problem, setProblem] = useState<string | null>(null);

  const conditions = useMemo(() => [...scenario.conditions, ...customs], [scenario, customs]);
  const layout = useMemo(() => layoutGraph(ledger), [ledger]);
  const marketOpen = Object.keys(resolutions).length === 0;
  const { portfolio } = ledger;

  const selectedNode =
    selection.kind === "position"
      ? (ledger.nodes.find((node) => node.key === selection.key) ?? null)
      : null;
  const selectedCondition =
    selection.kind === "condition"
      ? (conditions.find((condition) => condition.key === selection.key) ?? null)
      : null;

  function select(next: Selection) {
    setSelection(next);
    setProblem(null);
  }

  function apply(change: () => Ledger): boolean {
    const next = attempt(change);
    if (next.ok) setLedger(next.value);
    setProblem(next.ok ? null : next.error);
    return next.ok;
  }

  function restart(next: Ledger, selected: Selection, keepQuestions: boolean) {
    setLedger(next);
    setMarket(
      keepQuestions
        ? customs.reduce(
            (extended, condition) => extendMarket(extended, condition.outcomes.length),
            start.market,
          )
        : start.market,
    );
    if (!keepQuestions) setCustoms([]);
    setResolutions({});
    setUnresolved(null);
    setHistory(next === start.example ? start.story : []);
    select(selected);
  }

  function addCondition(title: string, outcomes: readonly string[]): string | null {
    if (title === "") return "Give the question a name.";
    if (outcomes.length < 2) return "List at least two possible results, separated by commas.";
    if (new Set(outcomes).size < outcomes.length) return "Each result needs a different name.";
    if (market.atoms.length * outcomes.length > MAX_COMBINATIONS) {
      return "That is more combinations of results than the simulated market can price.";
    }
    const condition = defineCondition(`custom-${customs.length}`, title, title, outcomes);
    if (conditions.some((other) => toHex(other.conditionId) === toHex(condition.conditionId))) {
      return "That question already exists.";
    }
    setCustoms([...customs, condition]);
    log(`Prepared the question “${title}” with the possible results ${outcomes.join(", ")}.`);
    setMarket(extendMarket(market, outcomes.length));
    select({ kind: "condition", key: condition.key });
    return null;
  }

  // Forget every reported result, and any redemption made since, but keep the positions.
  function resetResults() {
    if (unresolved) {
      setLedger(unresolved.ledger);
      setHistory(unresolved.history);
    }
    setUnresolved(null);
    setResolutions({});
    setProblem(null);
  }

  const amountOf = (amount: bigint) => formatTokenAmount(amount, decimals);
  const nameOf = (factors: readonly ConditionClause[]) => describeClaim(conditions, factors);

  const actions: Actions = {
    split: (parent, condition, partition, amount) => {
      if (apply(() => split(ledger, parent, condition, partition, amount))) {
        log(describeSplit(conditions, collateral, parent, condition, partition, amount));
      }
    },
    merge: (option) => {
      const done = apply(() =>
        merge(ledger, option.parent, option.condition, option.partition, option.amount),
      );
      if (!done) return;
      const pieces = `${amountOf(option.amount)} shares each of ${option.pieces.map((piece) => nameOf(piece.factors)).join(" and ")}`;
      log(
        option.result.length === 0
          ? `Merged ${pieces}. Together they covered every result, so ${tokens(option.amount)} was unlocked.`
          : `Merged ${pieces} back into ${amountOf(option.amount)} shares of ${nameOf(option.result)}.`,
      );
    },
    trade: (factors, shares, payment, next) => {
      if (!apply(() => trade(ledger, factors, shares, payment))) return;
      setMarket(next);
      const count = shares < 0n ? -shares : shares;
      const paid = payment < 0n ? -payment : payment;
      const each = Math.round((toNumber(paid, decimals) / toNumber(count, decimals)) * 100);
      log(
        `${shares > 0n ? "Bought" : "Sold"} ${amountOf(count)} shares of ${nameOf(factors)} for ${tokens(paid)}, about ${each}¢ each.`,
      );
    },
    redeem: (key, factorIndex) => {
      const node = ledger.nodes.find((candidate) => candidate.key === key)!;
      const condition = findCondition(conditions, node.factors[factorIndex]!.conditionId);
      const numerators = resolutions[condition.key]!;
      const step = attempt(() => redemption(ledger, key, factorIndex, numerators));
      if (!apply(() => redeem(ledger, key, factorIndex, numerators)) || !step.ok) return;
      log(
        `Redeemed ${amountOf(step.value.input)} shares of ${nameOf(node.factors)} and received ${
          step.value.residual.length === 0
            ? tokens(step.value.output)
            : `${amountOf(step.value.output)} shares of ${nameOf(step.value.residual)}`
        }.`,
      );
    },
    report: (conditionKey, numerators) => {
      if (Object.keys(resolutions).length === 0) setUnresolved({ ledger, history });
      setResolutions({ ...resolutions, [conditionKey]: numerators });
      setProblem(null);
      const condition = conditions.find((candidate) => candidate.key === conditionKey)!;
      const total = numerators.reduce((sum, weight) => sum + weight, 0n);
      const shares = condition.outcomes
        .map((label, outcome) => ({ label, weight: numerators[outcome]! }))
        .filter(({ weight }) => weight > 0n);
      log(
        `Resolved “${condition.title}”: ${
          shares.length === 1
            ? shares[0]!.label
            : shares
                .map(
                  ({ label, weight }) =>
                    `${label} ${Math.round((Number(weight) / Number(total)) * 100)}%`,
                )
                .join(", ")
        }.`,
      );
    },
    resetResults,
    fail: setProblem,
  };

  const resolved = (factor: ConditionClause) =>
    resolutions[findCondition(conditions, factor.conditionId).key];
  // What a share is known to pay once every question in it has a result.
  const settledValue = (factors: readonly ConditionClause[]): number | null => {
    let value = 1;
    for (const factor of factors) {
      const numerators = resolved(factor);
      if (!numerators) return null;
      const ratio = payoutRatio(numerators, factor.indexSet);
      value *= Number(ratio.numerator) / Number(ratio.denominator);
    }
    return value;
  };
  // The exact amount a holding redeems for, one floor per question.
  const payoutOf = (factors: readonly ConditionClause[], amount: bigint): bigint => {
    const steps = simulateRedemption(
      factors,
      (conditionId) => resolutions[findCondition(conditions, conditionId).key]!,
      amount,
    );
    return steps[steps.length - 1]!.output;
  };
  const priceOf = (factors: readonly ConditionClause[]) =>
    price(market, claimAtoms(market, conditions, factors));

  const graphNodes: GraphNode[] = [
    {
      key: COLLATERAL_KEY,
      context: "Your wallet",
      title: `Free ${symbol}`,
      amount: formatTokenAmount(portfolio.collateral, decimals),
      empty: portfolio.collateral === 0n,
      wallet: true,
    },
    ...ledger.nodes.map((node) => {
      const held = balanceOf(ledger, node.key);
      const settled = settledValue(node.factors);
      const redeemable = held > 0n && node.factors.some(resolved);
      const payout = settled !== null && held > 0n ? payoutOf(node.factors, held) : null;
      const highlight =
        payout !== null
          ? payout > 0n
            ? "Pays out"
            : "Pays nothing"
          : redeemable
            ? "Redeem"
            : node.key === start.exampleKey
              ? "Example"
              : null;
      return {
        key: node.key,
        ...boxLabel(conditions, node.factors),
        amount: `${formatTokenAmount(held, decimals)} sh`,
        detail: marketOpen
          ? `${Math.round(priceOf(node.factors) * 100)}¢`
          : settled === null
            ? ""
            : payout === null
              ? `pays ${settled.toFixed(2)} each`
              : `pays ${formatTokenAmount(payout, decimals)}`,
        empty: held === 0n,
        ...(payout === null ? {} : { tone: payout > 0n ? ("win" as const) : ("lose" as const) }),
        ...(highlight ? { highlight } : {}),
      };
    }),
  ];

  // Where a position came from, in words.
  const originOf = (key: string): string => {
    const sources = ledger.edges.filter((edge) => edge.to === key).map((edge) => edge.from);
    const held = balanceOf(ledger, key);
    const pieces = ledger.edges.filter((edge) => edge.from === key).length;
    const from = sources
      .map((source) =>
        source === COLLATERAL_KEY
          ? `a ${symbol} deposit`
          : describeClaim(conditions, ledger.nodes.find((node) => node.key === source)!.factors),
      )
      .join(" and from ");
    const left =
      held === 0n
        ? "You hold none of it now"
        : `You hold ${formatTokenAmount(held, decimals)} shares of it`;
    return `It was split from ${from}. ${left}${pieces > 0 ? `; the rest went into the ${pieces} positions below it` : ""}.`;
  };

  const workspace = { collateral, conditions, ledger, market, marketOpen, resolutions, actions };
  const change = portfolio.collateral - start.wallet;
  // Known once every question behind every holding has a result.
  const allSettled =
    portfolio.holdings.length > 0 &&
    portfolio.holdings.every((holding) => holding.factors.every(resolved));
  const finish = allSettled
    ? portfolio.holdings.reduce(
        (sum, holding) => sum + payoutOf(holding.factors, holding.amount),
        portfolio.collateral,
      )
    : null;

  function redeemEverything() {
    apply(() => {
      let next = ledger;
      for (;;) {
        const node = next.nodes.find(
          (candidate) => balanceOf(next, candidate.key) > 0n && candidate.factors.some(resolved),
        );
        if (!node) return next;
        const index = node.factors.findIndex(resolved);
        next = redeem(next, node.key, index, resolved(node.factors[index]!)!);
      }
    });
    if (finish !== null) {
      log(`Redeemed every position and received ${tokens(finish - portfolio.collateral)}.`);
    }
    select({ kind: "wallet" });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <select
            value={scenario.key}
            onChange={(event) => props.onSelectScenario(event.target.value)}
            aria-label="Scenario"
            className="rounded-md border border-line bg-page px-2 py-1.5 font-medium"
          >
            {SCENARIOS.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.title}
              </option>
            ))}
          </select>
          {finish !== null && (
            <>
              <Verdict label="Result" change={finish - start.wallet} format={tokens} />
              <button
                type="button"
                onClick={redeemEverything}
                className="rounded-md bg-good px-3 py-1 font-medium text-panel"
              >
                Redeem everything
              </button>
            </>
          )}
          {portfolio.holdings.length === 0 && (
            <Verdict label="Nothing locked" change={change} format={tokens} />
          )}
          <span className="ml-auto flex gap-4">
            {!marketOpen && (
              <button type="button" onClick={resetResults} className="text-accent underline">
                Reset results
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                restart(start.example, { kind: "position", key: start.exampleKey }, false)
              }
              className="text-accent underline"
            >
              Load the example
            </button>
            <button
              type="button"
              onClick={() => restart(start.empty, { kind: "wallet" }, true)}
              className="text-accent underline"
            >
              Start from scratch
            </button>
          </span>
        </div>

        <Questions
          conditions={conditions}
          resolutions={resolutions}
          selectedKey={selectedCondition?.key ?? null}
          onSelect={(key) => select({ kind: "condition", key })}
          onAdd={addCondition}
        />

        <div className="mb-3 flex flex-wrap items-stretch gap-2 text-sm">
          <span className="self-center text-muted">Balance</span>
          <div className="rounded-lg border border-line px-3 py-1.5">
            <div className="text-xs text-muted">Free {symbol}</div>
            <div className="font-mono">{amountOf(portfolio.collateral)}</div>
          </div>
          {portfolio.holdings.map((holding) => {
            const settled = holding.factors.every(resolved);
            const chance = priceOf(holding.factors);
            const payout = settled ? payoutOf(holding.factors, holding.amount) : null;
            const chosen = selectedNode?.key === holding.key;
            return (
              <button
                key={holding.key}
                type="button"
                aria-pressed={chosen}
                title={`Each share pays 1 ${symbol} if ${claimStatement(conditions, holding.factors)}`}
                onClick={() => select({ kind: "position", key: holding.key })}
                className={`rounded-lg border px-3 py-1.5 text-left ${
                  chosen ? "border-accent bg-accent-soft" : "border-line hover:border-muted"
                }`}
              >
                <span className="block text-xs text-muted">
                  {claimStatement(conditions, holding.factors)}
                </span>
                <span className="flex items-baseline gap-3 font-mono">
                  {amountOf(holding.amount)} sh
                  <span
                    className={`text-xs ${
                      payout === null ? "text-muted" : payout > 0n ? "text-good" : "text-bad"
                    }`}
                  >
                    {marketOpen
                      ? `${Math.round(chance * 100)}% · ≈ ${(toNumber(holding.amount, decimals) * chance).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                      : payout === null
                        ? "waiting"
                        : `pays ${amountOf(payout)}`}
                  </span>
                </span>
              </button>
            );
          })}
          {(finish !== null || portfolio.holdings.length === 0) && (
            <div className="ml-auto self-center font-medium">
              {finish !== null
                ? `Once redeemed you will have ${tokens(finish)}: ${verdict(finish - start.wallet, tokens)}.`
                : `Nothing is locked: ${verdict(change, tokens)}.`}
            </div>
          )}
        </div>

        <PositionGraph
          nodes={graphNodes}
          edges={ledger.edges}
          layout={layout}
          selectedKey={
            selectedNode ? selectedNode.key : selection.kind === "condition" ? "" : COLLATERAL_KEY
          }
          toolbar={
            selection.kind === "condition" ? null : (
              <NodeActions
                key={`${selectedNode?.key ?? COLLATERAL_KEY}:${selectedNode ? balanceOf(ledger, selectedNode.key) : portfolio.collateral}`}
                {...workspace}
                node={selectedNode}
              />
            )
          }
          onSelect={(key) =>
            select(key === COLLATERAL_KEY ? { kind: "wallet" } : { kind: "position", key })
          }
        />

        <p className="mt-3 text-xs text-muted">
          {scenario.summary} Simulated in your browser; nothing is sent to a blockchain.{" "}
          <a href={ROUTES.docs} className="text-accent underline">
            How it works
          </a>
        </p>
      </section>

      <div className="flex flex-col gap-3 xl:sticky xl:top-18 xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
        {problem && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{problem}</p>}
        {selectedCondition ? (
          <ConditionInspector
            key={selectedCondition.key}
            {...workspace}
            condition={selectedCondition}
            example={scenario.payouts[selectedCondition.key]}
            exampleNote={
              scenario.payouts[selectedCondition.key] ? `Example: ${scenario.resolution}` : ""
            }
          />
        ) : selectedNode ? (
          <PositionInspector
            key={selectedNode.key}
            {...workspace}
            node={selectedNode}
            origin={originOf(selectedNode.key)}
            {...(selectedNode.key === start.exampleKey ? { tag: "Example claim" } : {})}
          />
        ) : (
          <WalletInspector {...workspace} />
        )}
        <section className="rounded-xl border border-line bg-panel p-5 text-sm">
          <h2 className="font-medium">What you did</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-muted">
              Nothing yet. Select your wallet in the graph and use Deposit and split to start.
            </p>
          ) : (
            <ol className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
              {history.map((sentence, index) => {
                const cut = sentence.indexOf(" ");
                return (
                  <li key={index} className="text-muted">
                    <span className="font-medium text-ink">{sentence.slice(0, cut)}</span>
                    {sentence.slice(cut)}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function verdict(change: bigint, format: (amount: bigint) => string): string {
  return change === 0n
    ? "even"
    : change > 0n
      ? `a profit of ${format(change)}`
      : `a loss of ${format(-change)}`;
}

// A split in words: a deposit when it starts from collateral, a cut otherwise.
function describeSplit(
  conditions: readonly DemoCondition[],
  collateral: Scenario["collateral"],
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): string {
  const shares = formatTokenAmount(amount, collateral.decimals);
  const pieces = partition
    .map((indexSet) => describeClaim(conditions, [...parent, { ...condition, indexSet }]))
    .join(" and ");
  const source = partitionSource(parent, condition, partition);
  return source.length === 0
    ? `Deposited ${shares} ${collateral.symbol} on “${findCondition(conditions, condition.conditionId).title}” and received ${shares} shares each of ${pieces}.`
    : `Split ${shares} shares of ${describeClaim(conditions, source)} into ${shares} shares each of ${pieces}.`;
}

function Verdict(props: { label: string; change: bigint; format: (amount: bigint) => string }) {
  const { change } = props;
  return (
    <span
      className={`rounded-md px-2.5 py-1 font-semibold ${
        change >= 0n ? "bg-good-soft text-good" : "bg-bad-soft text-bad"
      }`}
    >
      {props.label}:{" "}
      {change === 0n
        ? "even"
        : change > 0n
          ? `profit ${props.format(change)}`
          : `loss ${props.format(-change)}`}
    </span>
  );
}

export function Questions(props: {
  conditions: readonly DemoCondition[];
  resolutions: Resolutions;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onAdd: (title: string, outcomes: readonly string[]) => string | null;
  // Ready-made questions offered in the form.
  examples?: readonly Readonly<{ title: string; outcomes: readonly string[] }>[];
  // Takes a question off the list, where that is possible.
  removable?: (key: string) => boolean;
  onRemove?: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const failure = props.onAdd(
      title.trim(),
      outcomes
        .split(",")
        .map((label) => label.trim())
        .filter((label) => label !== ""),
    );
    setError(failure);
    if (failure === null) {
      setAdding(false);
      setTitle("");
      setOutcomes("");
    }
  }

  const field = "min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1 text-sm";
  return (
    <div className="my-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Questions</span>
        {props.conditions.map((condition) => {
          const selected = condition.key === props.selectedKey;
          const done = props.resolutions[condition.key] !== undefined;
          const removable =
            props.onRemove !== undefined && (props.removable?.(condition.key) ?? true);
          return (
            <span
              key={condition.key}
              className={`flex items-center rounded-full border ${
                selected
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line hover:border-muted"
              }`}
            >
              <button
                type="button"
                aria-pressed={selected}
                title={condition.question}
                onClick={() => props.onSelect(condition.key)}
                className={`flex items-center gap-2 py-1 pl-3 ${removable ? "pr-1" : "pr-3"}`}
              >
                {condition.title}
                <span className={`text-xs ${done ? "text-good" : "text-muted"}`}>
                  {done ? "resolved" : `${condition.outcomes.length} results`}
                </span>
              </button>
              {removable && (
                <button
                  type="button"
                  onClick={() => props.onRemove?.(condition.key)}
                  aria-label={`Hide ${condition.title}`}
                  title="Hide from this list"
                  className="py-1 pr-2.5 pl-1 leading-none text-muted hover:text-bad"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-accent underline">
            + Prepare a question
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Question, e.g. Rain on launch day"
            aria-label="Question"
            className={field}
          />
          <input
            value={outcomes}
            onChange={(event) => setOutcomes(event.target.value)}
            placeholder="Possible results, e.g. yes, no"
            aria-label="Possible results, separated by commas"
            className={field}
          />
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-accent px-3 py-1 font-medium text-panel"
          >
            Prepare question
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
            className="text-muted hover:text-ink"
          >
            Cancel
          </button>
          {error && <p className="w-full text-bad">{error}</p>}
          {props.examples && props.examples.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-2">
              <span className="text-muted">Examples</span>
              {props.examples.map((example) => (
                <button
                  key={example.title + example.outcomes.join()}
                  type="button"
                  title={example.outcomes.join(", ")}
                  onClick={() => {
                    setTitle(example.title);
                    setOutcomes(example.outcomes.join(", "));
                    setError(null);
                  }}
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent"
                >
                  {example.title}
                  <span className="ml-1.5 text-muted">{example.outcomes.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
