import type { ConditionClause } from "@cc-token/sdk";
import { complementIndexSet } from "@cc-token/sdk";
import { useMemo, useState, type ReactNode } from "react";

import { Badge, Chip, Panel } from "./components.tsx";
import {
  attempt,
  describeSubset,
  findCondition,
  formatTokenAmount,
  holdingKey,
  indexSetFromOutcomes,
  initialPortfolio,
  mergeOptions,
  mergePositions,
  outcomesInIndexSet,
  parseTokenAmount,
  simulateRedemption,
  splitPosition,
  subtractIndexSet,
  toHex,
  type Collateral,
  type Composition,
  type DemoCondition,
  type Holding,
  type MergeOption,
  type Portfolio,
  type RedemptionStep,
  type Scenario,
} from "./scenario.ts";

type Payouts = Readonly<Record<string, readonly string[]>>;

// `factorIndex` set: cut that selection into two pieces. Otherwise: split by `conditionKey`.
type SplitDraft = Readonly<{
  sourceKey: string;
  factorIndex: number | null;
  conditionKey: string;
  outcomes: readonly number[];
  shares: string;
}>;

const COLLATERAL_KEY = holdingKey([]);

function parseWeight(text: string): bigint {
  if (!/^\d+$/.test(text.trim())) throw new RangeError(`"${text}" is not a whole number`);
  return BigInt(text.trim());
}

function isSingleWinner(weights: readonly string[]): boolean {
  const values = weights.map((weight) => weight.trim());
  return (
    values.every((value) => value === "0" || value === "1") &&
    values.filter((value) => value === "1").length === 1
  );
}

// A question used twice multiplies; otherwise the selections simply all have to hold.
export function describeClaim(
  conditions: readonly DemoCondition[],
  factors: readonly ConditionClause[],
): string {
  const ids = factors.map((factor) => toHex(factor.conditionId));
  const joiner = new Set(ids).size < ids.length ? " × " : " and ";
  return factors
    .map(
      (factor) =>
        `(${describeSubset(findCondition(conditions, factor.conditionId), factor.indexSet)})`,
    )
    .join(joiner);
}

export function DepositFlow(props: {
  firstNumber: number;
  scenario: Scenario;
  composition: Composition;
}) {
  const { symbol, decimals } = props.scenario.collateral;
  const [deposit, setDeposit] = useState(props.scenario.deposit);
  const amount = useMemo(
    () => attempt(() => parseTokenAmount(deposit, decimals)),
    [deposit, decimals],
  );

  if (props.composition.plan.factors.length === 0) return null;

  return (
    <>
      <Panel
        title={`${props.firstNumber}. Today: you deposit`}
        hint="The deposit is locked as collateral. In return you get shares, shown in the next panel."
      >
        <AmountInput value={deposit} onChange={setDeposit} unit={symbol} />
        {!amount.ok && (
          <div className="mt-3">
            <Badge tone="bad">{amount.error}</Badge>
          </div>
        )}
      </Panel>
      {amount.ok && amount.value > 0n && (
        <Holdings
          key={`${toHex(props.composition.plan.collectionId)}:${amount.value}`}
          firstNumber={props.firstNumber + 1}
          scenario={props.scenario}
          targetFactors={props.composition.plan.factors}
          deposit={amount.value}
        />
      )}
    </>
  );
}

function Holdings(props: {
  firstNumber: number;
  scenario: Scenario;
  targetFactors: readonly ConditionClause[];
  deposit: bigint;
}) {
  const { conditions, collateral } = props.scenario;
  const { symbol, decimals } = collateral;
  const shares = (amount: bigint) => formatTokenAmount(amount, decimals);
  const tokens = (amount: bigint) => `${shares(amount)} ${symbol}`;
  const targetKey = holdingKey(props.targetFactors);

  const start = useMemo(
    () => initialPortfolio(props.targetFactors, props.deposit),
    [props.targetFactors, props.deposit],
  );
  const [portfolio, setPortfolio] = useState<Portfolio>(start);
  const [draft, setDraft] = useState<SplitDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [payouts, setPayouts] = useState(props.scenario.payouts);
  const [price, setPrice] = useState(props.scenario.price);
  const [chosenKey, setChosenKey] = useState(targetKey);

  const merges = useMemo(() => mergeOptions(portfolio), [portfolio]);
  const claimMerges = merges.filter((option) => option.result.length > 0);
  const cashOuts = merges.filter((option) => option.result.length === 0);
  const chosen =
    portfolio.holdings.find((holding) => holding.key === chosenKey) ?? portfolio.holdings[0];

  function apply(change: () => Portfolio) {
    const next = attempt(change);
    if (next.ok) {
      setPortfolio(next.value);
      setDraft(null);
      setProblem(null);
    } else {
      setProblem(next.error);
    }
  }

  function applyMerge(option: MergeOption) {
    apply(() =>
      mergePositions(portfolio, option.parent, option.condition, option.partition, option.amount),
    );
  }

  const payout = useMemo(
    () =>
      attempt(() => {
        const weights = (conditionId: Parameters<typeof findCondition>[1]) =>
          payouts[findCondition(conditions, conditionId).key]!.map(parseWeight);
        const rows = portfolio.holdings.map((holding) => {
          const steps = simulateRedemption(holding.factors, weights, holding.amount);
          return { holding, steps, pays: steps[steps.length - 1]!.output };
        });
        return {
          rows,
          total: rows.reduce((sum, row) => sum + row.pays, portfolio.collateral),
        };
      }),
    [conditions, payouts, portfolio],
  );

  const usedConditions = conditions.filter((condition) =>
    portfolio.holdings.some((holding) =>
      holding.factors.some((factor) => toHex(factor.conditionId) === toHex(condition.conditionId)),
    ),
  );

  const label = (holding: Holding) => (
    <>
      {holding.key === targetKey && <div className="text-xs text-accent">Your claim</div>}
      {describeClaim(conditions, holding.factors)}
    </>
  );

  return (
    <>
      <Panel
        title={`${props.firstNumber}. You hold shares, and can split or merge them`}
        hint={`The deposit became one claim for each way things can turn out, with ${shares(props.deposit)} shares of each. They are all yours: keep the ones you believe in and sell the rest. Before that, you can reshape them. Splitting cuts a claim into narrower ones and merging puts them back; neither needs a new deposit or changes what the holdings are worth in total.`}
      >
        <table className="w-full text-sm">
          <tbody>
            {portfolio.collateral > 0n && (
              <tr>
                <td className="px-2 py-2">
                  <div className="text-xs text-muted">Unlocked, back in your wallet</div>
                  {symbol}
                </td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                  {tokens(portfolio.collateral)}
                </td>
                <td className="w-20 px-2 py-2 text-right">
                  <RowButton
                    onClick={() =>
                      setDraft({
                        sourceKey: COLLATERAL_KEY,
                        factorIndex: null,
                        conditionKey: conditions[0]!.key,
                        outcomes: [],
                        shares: "",
                      })
                    }
                  >
                    Split
                  </RowButton>
                </td>
              </tr>
            )}
            {portfolio.holdings.map((holding) => (
              <tr key={holding.key} className={holding.key === targetKey ? "bg-accent-soft" : ""}>
                <td className="rounded-l-md px-2 py-2">{label(holding)}</td>
                <td className="px-2 py-2 text-right align-bottom font-mono whitespace-nowrap">
                  {shares(holding.amount)} shares
                </td>
                <td className="w-20 rounded-r-md px-2 py-2 text-right align-bottom">
                  <RowButton
                    onClick={() => {
                      const cuttable = holding.factors.findIndex(
                        (factor) =>
                          outcomesInIndexSet(factor.indexSet, factor.outcomeCount).length > 1,
                      );
                      setDraft({
                        sourceKey: holding.key,
                        factorIndex: cuttable === -1 ? null : cuttable,
                        conditionKey: conditions[0]!.key,
                        outcomes: [],
                        shares: "",
                      });
                    }}
                  >
                    Split
                  </RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {draft && (
          <SplitEditor
            scenario={props.scenario}
            portfolio={portfolio}
            draft={draft}
            onChange={setDraft}
            onCancel={() => {
              setDraft(null);
              setProblem(null);
            }}
            onProblem={setProblem}
            onSplit={(parent, condition, partition, amount) =>
              apply(() => splitPosition(portfolio, parent, condition, partition, amount))
            }
          />
        )}

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-medium">Merge claims into a broader claim</h3>
          <p className="mt-1 text-sm text-muted">
            The reverse of a split. You still hold a claim afterwards, just a wider one.
          </p>
          {claimMerges.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing to merge right now. Split a claim and its pieces will appear here.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {claimMerges.map((option) => (
                <li
                  key={`${option.left.key}:${option.right.key}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    {describeClaim(conditions, option.left.factors)}
                    <span className="text-muted"> + </span>
                    {describeClaim(conditions, option.right.factors)}
                    <span className="text-muted"> → </span>
                    {describeClaim(conditions, option.result)}
                  </span>
                  <RowButton onClick={() => applyMerge(option)}>
                    Merge {shares(option.amount)}
                  </RowButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-medium">Cash out a full set for {symbol}</h3>
          <p className="mt-1 text-sm text-muted">
            When two holdings cover every possible result between them, they are a full set. Merging
            a full set ends those claims and unlocks the {symbol} behind them, without waiting for a
            result.
          </p>
          {cashOuts.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No full set right now. Merge narrower claims first until two holdings cover every
              result.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {cashOuts.map((option) => (
                <li
                  key={`${option.left.key}:${option.right.key}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-good bg-good-soft px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    {describeClaim(conditions, option.left.factors)}
                    <span className="text-muted"> + </span>
                    {describeClaim(conditions, option.right.factors)}
                  </span>
                  <RowButton onClick={() => applyMerge(option)}>
                    Unlock {tokens(option.amount)}
                  </RowButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        {problem && (
          <p className="mt-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{problem}</p>
        )}
        {portfolio !== start && (
          <button
            type="button"
            onClick={() => {
              setPortfolio(start);
              setDraft(null);
              setProblem(null);
            }}
            className="mt-4 text-sm text-accent underline"
          >
            Start again from the deposit
          </button>
        )}
      </Panel>

      <Panel
        title={`${props.firstNumber + 1}. Later: the result is reported`}
        hint={`When the questions are settled, the party named as their resolver reports what happened. Example: ${props.scenario.resolution}`}
      >
        <ResultInputs conditions={usedConditions} payouts={payouts} onChange={setPayouts} />
      </Panel>

      <Panel
        title={`${props.firstNumber + 2}. Each holding can be redeemed`}
        hint={`A share pays between 0 and 1 ${symbol}. However you split or merged, the holdings together pay back the deposit.`}
      >
        {payout.ok ? (
          <>
            <table className="w-full text-sm">
              <tbody>
                {portfolio.collateral > 0n && (
                  <tr>
                    <td className="px-2 py-2" colSpan={2}>
                      {symbol}, already unlocked
                    </td>
                    <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                      {tokens(portfolio.collateral)}
                    </td>
                  </tr>
                )}
                {payout.value.rows.map(({ holding, pays }) => (
                  <tr
                    key={holding.key}
                    className={holding.key === targetKey ? "bg-accent-soft" : ""}
                  >
                    <td className="w-8 rounded-l-md px-2 py-2 align-bottom">
                      <input
                        type="radio"
                        name="chosen-holding"
                        aria-label="Use this holding for the result below"
                        checked={chosen?.key === holding.key}
                        onChange={() => setChosenKey(holding.key)}
                      />
                    </td>
                    <td className="px-2 py-2">{label(holding)}</td>
                    <td className="rounded-r-md px-2 py-2 text-right align-bottom font-mono whitespace-nowrap">
                      pays {tokens(pays)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="px-2 py-2 text-muted" colSpan={2}>
                    Everything together
                  </td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                    {tokens(payout.value.total)}
                  </td>
                </tr>
              </tbody>
            </table>
            {payout.value.total < props.deposit && (
              <p className="mt-2 text-sm text-muted">
                {tokens(props.deposit - payout.value.total)} stays locked because each redemption
                step rounds down.
              </p>
            )}

            {chosen && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="font-medium">Your result if you held only the selected claim</h3>
                <p className="mt-1 text-sm text-muted">
                  This demo has no market, so enter what a share of it cost you. A price of 0.40{" "}
                  {symbol} means buyers thought it had about a 40% chance of paying in full.
                </p>
                <div className="mt-3">
                  <AmountInput value={price} onChange={setPrice} unit={`${symbol} per share`} />
                </div>
                <ProfitAndLoss
                  collateral={collateral}
                  price={price}
                  shares={chosen.amount}
                  payout={payout.value.rows.find((row) => row.holding.key === chosen.key)!.pays}
                />
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Show the calculation</summary>
                  <RedemptionSteps
                    conditions={conditions}
                    decimals={decimals}
                    steps={payout.value.rows.find((row) => row.holding.key === chosen.key)!.steps}
                  />
                </details>
              </div>
            )}
          </>
        ) : (
          <Badge tone="bad">{payout.error}</Badge>
        )}
      </Panel>
    </>
  );
}

function RowButton(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-md border border-line px-2.5 py-1 text-sm whitespace-nowrap hover:border-accent hover:text-accent"
    >
      {props.children}
    </button>
  );
}

function SplitEditor(props: {
  scenario: Scenario;
  portfolio: Portfolio;
  draft: SplitDraft;
  onChange: (draft: SplitDraft) => void;
  onCancel: () => void;
  onProblem: (message: string) => void;
  onSplit: (
    parent: readonly ConditionClause[],
    condition: Readonly<{ conditionId: ConditionClause["conditionId"]; outcomeCount: number }>,
    partition: readonly ConditionClause["indexSet"][],
    amount: bigint,
  ) => void;
}) {
  const { conditions, collateral } = props.scenario;
  const { draft } = props;
  const source = props.portfolio.holdings.find((holding) => holding.key === draft.sourceKey);
  const factors = source?.factors ?? [];
  const available = source?.amount ?? props.portfolio.collateral;

  const cuttable = factors
    .map((factor, index) => ({ factor, index }))
    .filter(({ factor }) => outcomesInIndexSet(factor.indexSet, factor.outcomeCount).length > 1);
  const cutting = draft.factorIndex === null ? null : factors[draft.factorIndex]!;
  const condition = cutting
    ? findCondition(conditions, cutting.conditionId)
    : conditions.find((candidate) => candidate.key === draft.conditionKey)!;
  const choices = cutting
    ? outcomesInIndexSet(cutting.indexSet, cutting.outcomeCount)
    : condition.outcomes.map((_, outcome) => outcome);
  const repeats =
    !cutting &&
    factors.some((factor) => toHex(factor.conditionId) === toHex(condition.conditionId));
  const ready = draft.outcomes.length > 0 && draft.outcomes.length < choices.length;

  function submit() {
    const amount = attempt(() =>
      draft.shares.trim() === "" ? available : parseTokenAmount(draft.shares, collateral.decimals),
    );
    if (!amount.ok) return props.onProblem(amount.error);
    const ref = { conditionId: condition.conditionId, outcomeCount: condition.outcomes.length };
    const first = indexSetFromOutcomes(draft.outcomes);
    if (cutting) {
      props.onSplit(
        factors.filter((_, index) => index !== draft.factorIndex),
        ref,
        [first, subtractIndexSet(cutting.indexSet, first)],
        amount.value,
      );
    } else {
      props.onSplit(
        factors,
        ref,
        [first, complementIndexSet(condition.outcomes.length, first)],
        amount.value,
      );
    }
  }

  const option = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-accent-soft text-accent" : "text-muted"}`;

  return (
    <div className="mt-4 rounded-lg border border-accent p-4">
      <h3 className="font-medium">
        Split {source ? describeClaim(conditions, factors) : `unlocked ${collateral.symbol}`}
      </h3>

      {cuttable.length > 0 && (
        <div className="mt-3 inline-flex flex-wrap rounded-lg border border-line p-0.5">
          {cuttable.map(({ factor, index }) => (
            <button
              key={index}
              type="button"
              aria-pressed={draft.factorIndex === index}
              onClick={() => props.onChange({ ...draft, factorIndex: index, outcomes: [] })}
              className={option(draft.factorIndex === index)}
            >
              Into narrower pieces of {findCondition(conditions, factor.conditionId).title}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={draft.factorIndex === null}
            onClick={() => props.onChange({ ...draft, factorIndex: null, outcomes: [] })}
            className={option(draft.factorIndex === null)}
          >
            By a question
          </button>
        </div>
      )}

      {!cutting && conditions.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Question</span>
          {conditions.map((candidate) => (
            <Chip
              key={candidate.key}
              selected={candidate.key === condition.key}
              onClick={() =>
                props.onChange({ ...draft, conditionKey: candidate.key, outcomes: [] })
              }
            >
              {candidate.title}
            </Chip>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm text-muted">
        {cutting
          ? "Select the results for the first piece. The rest of this claim's results form the second piece."
          : "Select the results for the first piece. All other results of the question form the second piece."}
        {repeats &&
          " This question is already part of the claim, so using it again multiplies its payout share."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((outcome) => (
          <Chip
            key={outcome}
            selected={draft.outcomes.includes(outcome)}
            onClick={() =>
              props.onChange({
                ...draft,
                outcomes: draft.outcomes.includes(outcome)
                  ? draft.outcomes.filter((candidate) => candidate !== outcome)
                  : [...draft.outcomes, outcome],
              })
            }
          >
            {condition.outcomes[outcome]}
          </Chip>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Shares to split</span>
          <input
            value={draft.shares}
            onChange={(event) => props.onChange({ ...draft, shares: event.target.value })}
            placeholder={`all ${formatTokenAmount(available, collateral.decimals)}`}
            inputMode="decimal"
            className="w-32 rounded-md border border-line bg-page px-2 py-1 font-mono"
          />
        </label>
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
        >
          Split
        </button>
        <button type="button" onClick={props.onCancel} className="text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AmountInput(props: { value: string; onChange: (value: string) => void; unit: string }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        inputMode="decimal"
        className="w-32 rounded-md border border-line bg-page px-2 py-1 font-mono"
      />
      <span className="text-muted">{props.unit}</span>
    </label>
  );
}

function ProfitAndLoss(props: {
  collateral: Collateral;
  price: string;
  shares: bigint;
  payout: bigint;
}) {
  const { symbol, decimals } = props.collateral;
  const format = (amount: bigint) => `${formatTokenAmount(amount, decimals)} ${symbol}`;
  const cost = attempt(() => {
    const oneShare = 10n ** BigInt(decimals);
    const price = parseTokenAmount(props.price, decimals);
    if (price > oneShare) throw new RangeError(`a share never pays more than 1 ${symbol}`);
    return (props.shares * price) / oneShare;
  });
  if (!cost.ok) {
    return (
      <div className="mt-3">
        <Badge tone="bad">{cost.error}</Badge>
      </div>
    );
  }
  const profit = props.payout - cost.value;
  return (
    <div className="mt-3">
      <Badge tone={profit >= 0n ? "good" : "bad"}>
        Cost {format(cost.value)}, pays {format(props.payout)}:{" "}
        {profit >= 0n ? `profit ${format(profit)}` : `loss ${format(-profit)}`}
      </Badge>
    </div>
  );
}

function ResultInputs(props: {
  conditions: readonly DemoCondition[];
  payouts: Payouts;
  onChange: (payouts: Payouts) => void;
}) {
  const [custom, setCustom] = useState(() =>
    props.conditions.some((condition) => !isSingleWinner(props.payouts[condition.key]!)),
  );

  function setWeights(conditionKey: string, weights: readonly string[]) {
    props.onChange({ ...props.payouts, [conditionKey]: weights });
  }

  return (
    <div className="flex flex-col gap-4">
      {props.conditions.map((condition) => {
        const weights = props.payouts[condition.key]!;
        return (
          <div key={condition.key}>
            <div className="text-sm text-muted">{condition.title}</div>
            {custom ? (
              <div className="mt-2 flex flex-wrap gap-3">
                {condition.outcomes.map((label, outcome) => (
                  <label key={label} className="flex flex-col gap-1 text-xs text-muted">
                    {label}
                    <input
                      value={weights[outcome]}
                      onChange={(event) =>
                        setWeights(
                          condition.key,
                          weights.map((value, other) =>
                            other === outcome ? event.target.value : value,
                          ),
                        )
                      }
                      inputMode="numeric"
                      className="w-24 rounded-md border border-line bg-page px-2 py-1 font-mono text-sm text-ink"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {condition.outcomes.map((label, outcome) => (
                  <Chip
                    key={label}
                    selected={weights[outcome]?.trim() === "1"}
                    onClick={() =>
                      setWeights(
                        condition.key,
                        condition.outcomes.map((_, other) => (other === outcome ? "1" : "0")),
                      )
                    }
                  >
                    {label}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="text-sm text-muted">
        {custom
          ? "Some results are shared instead of won outright, such as a tie or a measured fraction. Weights say how: 1 and 3 gives the first result a quarter and the second three quarters. "
          : "Pick the result that happened. "}
        <button
          type="button"
          onClick={() => {
            if (custom) {
              // Leaving custom mode needs a single winner; keep one that is already set.
              const next: Record<string, readonly string[]> = { ...props.payouts };
              for (const condition of props.conditions) {
                const weights = props.payouts[condition.key]!;
                if (isSingleWinner(weights)) continue;
                const winner = Math.max(
                  0,
                  weights.findIndex((weight) => weight.trim() !== "0"),
                );
                next[condition.key] = weights.map((_, other) => (other === winner ? "1" : "0"));
              }
              props.onChange(next);
            }
            setCustom(!custom);
          }}
          className="text-accent underline"
        >
          {custom ? "Pick a single result instead" : "Share the payout between results"}
        </button>
      </div>
    </div>
  );
}

function RedemptionSteps(props: {
  conditions: readonly DemoCondition[];
  decimals: number;
  steps: readonly RedemptionStep[];
}) {
  return (
    <ol className="mt-2 flex flex-col gap-1">
      {props.steps.map((step, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-muted">
            {describeSubset(
              findCondition(props.conditions, step.clause.conditionId),
              step.clause.indexSet,
            )}
          </span>
          <span className="font-mono">
            {formatTokenAmount(step.input, props.decimals)} × {step.numerator.toString()}/
            {step.denominator.toString()} → {formatTokenAmount(step.output, props.decimals)}
          </span>
        </li>
      ))}
    </ol>
  );
}
