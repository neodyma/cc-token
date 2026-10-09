import { complementIndexSet, derivePositionId, type ConditionClause } from "@cc-token/sdk";
import { useState, type ReactNode } from "react";

import { Badge, Chip, Identifier } from "./components.tsx";
import { balanceOf, COLLATERAL_KEY, redemption, type Ledger, type PositionNode } from "./ledger.ts";
import {
  buy,
  claimAtoms,
  outcomePrices,
  price,
  quote,
  toMarketAmount,
  type Market,
} from "./market.ts";
import {
  attempt,
  constructionPath,
  describeClaim,
  describeSubset,
  explainClaim,
  findCondition,
  formatTokenAmount,
  holdingKey,
  indexSetFromOutcomes,
  mergeOptions,
  outcomesInIndexSet,
  parsePayoutWeight,
  parseTokenAmount,
  repetition,
  subtractIndexSet,
  toHex,
  type Collateral,
  type ConditionRef,
  type DemoCondition,
  type MergeOption,
} from "./scenario.ts";

export type Resolutions = Readonly<Record<string, readonly bigint[]>>;

export type Actions = Readonly<{
  split: (
    parent: readonly ConditionClause[],
    condition: ConditionRef,
    partition: readonly ConditionClause["indexSet"][],
    amount: bigint,
  ) => void;
  merge: (option: MergeOption) => void;
  trade: (
    factors: readonly ConditionClause[],
    shares: bigint,
    collateral: bigint,
    market: Market,
  ) => void;
  redeem: (key: string, factorIndex: number) => void;
  report: (conditionKey: string, numerators: readonly bigint[]) => void;
  // Only on the live page: exchange native shares for the position's token, and back.
  wrap?: (key: string, amount: bigint) => void;
  unwrap?: (key: string, amount: bigint) => void;
  // Only on the live page: give native shares to another wallet.
  transfer?: (key: string, recipient: string, amount: bigint) => void;
  // Only the simulator can take a result back.
  resetResults?: () => void;
  fail: (message: string) => void;
}>;

type Workspace = Readonly<{
  collateral: Collateral;
  conditions: readonly DemoCondition[];
  ledger: Ledger;
  // The simulated venue. There is none on the live page.
  market: Market | null;
  marketOpen: boolean;
  // Shares held as the position's wrapper token, by position key. Live page only.
  wrapped?: ReadonlyMap<string, Readonly<{ amount: bigint; mint: string | null }>>;
  resolutions: Resolutions;
  actions: Actions;
}>;

function toNumber(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function Frame(props: { kind: string; tag?: string; title: string; children: ReactNode }) {
  return (
    <aside className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{props.kind}</span>
        {props.tag && <span className="font-medium text-accent">{props.tag}</span>}
      </div>
      <h2 className="mt-1 font-medium">{props.title}</h2>
      {props.children}
    </aside>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm">
      <span className="text-muted">{props.label}</span>
      <span className="text-right font-mono">{props.children}</span>
    </div>
  );
}

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.hint && <p className="mt-1 mb-3 text-sm text-muted">{props.hint}</p>}
      {props.children}
    </div>
  );
}

export function WalletInspector(props: Workspace) {
  const { symbol, decimals } = props.collateral;
  const free = props.ledger.portfolio.collateral;
  return (
    <Frame kind="Selected" title={`Free ${symbol}`}>
      <p className="mt-2 text-sm text-muted">
        {symbol} in your wallet that is not locked in any position.
      </p>
      <div className="mt-2">
        <Row label="Balance">
          {formatTokenAmount(free, decimals)} {symbol}
        </Row>
      </div>
      <p className="mt-3 text-sm text-muted">
        To deposit, use Deposit and split under the wallet box in the graph. It locks {symbol} as
        collateral and gives you the same number of shares of two positions on one question: the
        results you pick, and all the others. Together they are worth exactly what you locked.
      </p>
    </Frame>
  );
}

export function PositionInspector(
  props: Workspace & { node: PositionNode; tag?: string; origin: string },
) {
  const { collateral, conditions, ledger, node, market, actions } = props;
  const { symbol, decimals } = collateral;
  const held = balanceOf(ledger, node.key);
  const positionId = derivePositionId(collateral.mint, constructionPath(node.factors).collectionId);
  const wrapper = props.wrapped?.get(node.key);
  const marketPrice = market ? price(market, claimAtoms(market, conditions, node.factors)) : null;
  return (
    <Frame
      kind="Selected position"
      {...(props.tag ? { tag: props.tag } : {})}
      title={describeClaim(conditions, node.factors)}
    >
      <p className="mt-2 text-sm">{explainClaim(conditions, node.factors, symbol)}</p>
      <p className="mt-2 text-sm text-muted">{props.origin}</p>
      <div className="mt-3">
        <Row label="Shares held">{formatTokenAmount(held, decimals)}</Row>
        {wrapper && (
          <Row label="Wrapped as a token">{formatTokenAmount(wrapper.amount, decimals)}</Row>
        )}
        {props.marketOpen && marketPrice !== null && (
          <Row label="Market price">
            {marketPrice.toFixed(2)} {symbol} · {Math.round(marketPrice * 100)}%
          </Row>
        )}
      </div>
      <div className="mt-3">
        <Identifier
          label="Asset ID, the same in whatever order it is built"
          value={toHex(positionId)}
        />
      </div>
      {wrapper?.mint && (
        <div className="mt-3">
          <Identifier label="Token mint of the wrapped shares (Token-2022)" value={wrapper.mint} />
        </div>
      )}
    </Frame>
  );
}

type ActionPanel = "split" | "merge" | "trade" | "redeem" | "wrap" | "send";

// Outline icons on a 24 by 24 grid, one path per stroke.
const ACTION_ICONS: Readonly<Record<ActionPanel, readonly string[]>> = {
  // One line forking into two.
  split: ["M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3", "m15 9 6-6", "M16 3h5v5", "M8 3H3v5"],
  // Two lines joining into one.
  merge: ["M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22", "m20 22-5-5", "m8 6 4-4 4 4"],
  // Arrows in both directions.
  trade: ["M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4"],
  // A coin.
  redeem: [
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
    "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",
    "M12 18V6",
  ],
  // A paper plane.
  send: [
    "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
    "m21.854 2.147-10.94 10.939",
  ],
  // A box.
  wrap: [
    "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
    "m3.3 7 8.7 5 8.7-5",
    "M12 22V12",
    "m7.5 4.27 9 5.15",
  ],
};

// The buttons shown under the selected box in the graph. `node` is null for the wallet.
export function NodeActions(props: Workspace & { node: PositionNode | null }) {
  const { collateral, conditions, ledger, node, resolutions, actions } = props;
  const { symbol, decimals } = collateral;
  const [open, setOpen] = useState<ActionPanel | null>(null);
  const toggle = (panel: ActionPanel) => setOpen(open === panel ? null : panel);
  // An icon button. The label is the accessible name and shows on hover or focus.
  const tab = (panel: ActionPanel, label: string, disabled = false) => (
    <span className="group relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open === panel}
        disabled={disabled}
        onClick={() => toggle(panel)}
        className={`grid size-8 place-items-center rounded-md border shadow-sm disabled:cursor-not-allowed disabled:border-dashed disabled:text-muted disabled:hover:border-line ${
          open === panel
            ? "border-accent bg-accent text-panel"
            : "border-line bg-panel text-ink hover:border-accent hover:text-accent"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
        >
          {ACTION_ICONS[panel].map((path) => (
            <path key={path} d={path} />
          ))}
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded bg-ink px-2 py-0.5 text-xs font-medium whitespace-nowrap text-page opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
  const panel = (hint: string | null, children: ReactNode) => (
    <div className="mt-2 w-80 rounded-lg border border-line bg-panel p-3 text-left shadow-lg">
      {hint && <p className="mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </div>
  );

  // Merges that use this box's shares, and merges of other boxes that end up here.
  const key = node?.key ?? COLLATERAL_KEY;
  const onGraph = (option: MergeOption) =>
    option.result.length === 0 ||
    ledger.nodes.some((candidate) => candidate.key === holdingKey(option.result));
  // Merges that undo a split drawn on the graph come first.
  const merges = mergeOptions(ledger.portfolio)
    .filter(
      (option) =>
        option.pieces.some((piece) => piece.key === key) || holdingKey(option.result) === key,
    )
    .sort(
      (left, right) =>
        right.pieces.length - left.pieces.length || Number(onGraph(right)) - Number(onGraph(left)),
    );
  const mergeTab = tab("merge", "Merge", merges.length === 0);
  const mergeList = (
    <div className="flex flex-col gap-2">
      {merges.map((option) => {
        const amount = formatTokenAmount(option.amount, decimals);
        const cashOut = option.result.length === 0;
        const name = (pieces: MergeOption["pieces"]) =>
          pieces.map((piece) => describeClaim(conditions, piece.factors)).join(" + ");
        const every = name(option.pieces);
        const other = name(option.pieces.filter((piece) => piece.key !== key));
        const into = holdingKey(option.result) === key;
        return (
          <ActionButton
            key={option.pieces.map((piece) => piece.key).join(":")}
            tone={cashOut ? "good" : "accent"}
            label={
              cashOut
                ? `Unlock ${amount} ${symbol}`
                : into
                  ? `Merge ${amount} shares back into this`
                  : `Merge ${amount} shares`
            }
            note={
              into
                ? `${every}${cashOut ? ": together they cover every result, so the collateral is released" : ""}`
                : cashOut
                  ? `with ${other}: together they cover every result, so the collateral is released`
                  : `with ${other} → ${describeClaim(conditions, option.result)}`
            }
            onClick={() => actions.merge(option)}
          />
        );
      })}
    </div>
  );

  if (!node) {
    const free = ledger.portfolio.collateral;
    return (
      <div className="nodrag nopan flex flex-col items-center">
        <div className="flex gap-1.5">
          {tab("split", "Deposit and split", free === 0n)}
          {merges.length > 0 && mergeTab}
        </div>
        {open === "merge" && panel(null, mergeList)}
        {open === "split" &&
          panel(
            `Lock ${symbol} and receive two positions on one question.`,
            <SplitEditor {...props} sourceKey={COLLATERAL_KEY} />,
          )}
      </div>
    );
  }

  const held = balanceOf(ledger, node.key);
  const wrappedAmount = props.wrapped?.get(node.key)?.amount ?? 0n;
  const redeemable = node.factors
    .map((factor, index) => ({
      index,
      condition: findCondition(conditions, factor.conditionId),
    }))
    .filter(({ condition }) => resolutions[condition.key]);

  return (
    <div className="nodrag nopan flex flex-col items-center">
      <div className="flex gap-1.5">
        {tab("split", "Split", held === 0n)}
        {mergeTab}
        {props.market && props.marketOpen && tab("trade", "Buy / Sell")}
        {redeemable.length > 0 && tab("redeem", "Redeem", held === 0n)}
        {actions.wrap && tab("wrap", "Wrap / Unwrap", held === 0n && wrappedAmount === 0n)}
        {actions.transfer && tab("send", "Send", held === 0n)}
      </div>
      {open === "send" &&
        panel(
          "Give shares of this position to another wallet. It needs nothing set up beforehand and will find them on its Live page.",
          <SendEditor
            decimals={decimals}
            held={held}
            onSend={(recipient, amount) => actions.transfer?.(node.key, recipient, amount)}
            onFail={actions.fail}
          />,
        )}
      {open === "wrap" &&
        panel(
          "Wrapped shares are an ordinary Token-2022 token that other wallets and programs can hold. Unwrap them to split, merge or redeem.",
          <WrapEditor
            decimals={decimals}
            held={held}
            wrapped={wrappedAmount}
            onWrap={(amount) => actions.wrap?.(node.key, amount)}
            onUnwrap={(amount) => actions.unwrap?.(node.key, amount)}
            onFail={actions.fail}
          />,
        )}
      {open === "trade" && props.market && (
        <div className="mt-2 w-80 rounded-lg border border-line bg-panel p-3 text-left shadow-lg">
          <TradeTicket
            collateral={collateral}
            name={describeClaim(conditions, node.factors)}
            held={held}
            members={claimAtoms(props.market, conditions, node.factors)}
            free={ledger.portfolio.collateral}
            market={props.market}
            onTrade={(shares, payment, next) => actions.trade(node.factors, shares, payment, next)}
          />
        </div>
      )}
      {open === "split" &&
        panel(
          "Cut this position into two narrower ones. The pieces together are worth the same.",
          <SplitEditor {...props} sourceKey={node.key} />,
        )}
      {open === "merge" && panel(null, mergeList)}
      {open === "redeem" &&
        panel(
          "A reported result settles one question at a time. Redeeming removes that question and leaves what it paid.",
          <div className="flex flex-col gap-2">
            {redeemable.map(({ index, condition }) => {
              const step = redemption(ledger, node.key, index, resolutions[condition.key]!);
              return (
                <ActionButton
                  key={index}
                  tone="good"
                  label={`Redeem ${condition.title}`}
                  note={`${formatTokenAmount(step.input, decimals)} × ${step.numerator}/${step.denominator} → ${formatTokenAmount(step.output, decimals)} ${
                    step.residual.length > 0
                      ? `shares of ${describeClaim(conditions, step.residual)}`
                      : symbol
                  }`}
                  onClick={() => actions.redeem(node.key, index)}
                />
              );
            })}
          </div>,
        )}
    </div>
  );
}

export function ConditionInspector(
  props: Workspace & {
    condition: DemoCondition;
    example: readonly string[] | undefined;
    exampleNote: string;
    // Why the result cannot be reported from here, when it cannot.
    locked?: string;
  },
) {
  const { condition, market, resolutions, actions } = props;
  const index = props.conditions.findIndex((candidate) => candidate.key === condition.key);
  const reported = resolutions[condition.key];
  const prices = market ? outcomePrices(market, index) : null;
  const total = reported?.reduce((sum, weight) => sum + weight, 0n) ?? 0n;
  const [weights, setWeights] = useState<readonly string[]>(
    () => props.example ?? condition.outcomes.map((_, outcome) => (outcome === 0 ? "1" : "0")),
  );
  const [custom, setCustom] = useState(
    () => weights.filter((weight) => weight.trim() !== "0").length !== 1,
  );

  function report() {
    const numerators = attempt(() => {
      const values = weights.map(parsePayoutWeight);
      if (values.every((value) => value === 0n)) {
        throw new RangeError("at least one result needs a weight");
      }
      return values;
    });
    if (numerators.ok) actions.report(condition.key, numerators.value);
    else actions.fail(numerators.error);
  }

  return (
    <Frame kind="Selected question" tag={reported ? "Resolved" : "Open"} title={condition.title}>
      <p className="mt-2 text-sm text-muted">{condition.question}</p>
      <div className="mt-3">
        <Identifier label="Condition ID" value={toHex(condition.conditionId)} />
      </div>

      <Section title={reported ? "Final result" : "Possible results"}>
        <ul className="mt-2 flex flex-col gap-1.5">
          {condition.outcomes.map((label, outcome) => {
            const share = reported
              ? Number(reported[outcome]!) / Number(total)
              : (prices?.[outcome] ?? null);
            return (
              <li
                key={label}
                className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] items-center gap-2"
              >
                <span className="truncate text-sm" title={label}>
                  {label}
                </span>
                {share !== null && (
                  <>
                    <span className="h-2 overflow-hidden rounded-full bg-page">
                      <span
                        className={`block h-full rounded-full ${reported ? "bg-good" : "bg-accent"}`}
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs">
                      {(share * 100).toFixed(1)}%
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">
          {reported
            ? `The share of each result in the payout. ${
                actions.resetResults
                  ? "On-chain a reported result is final; here you can reset it."
                  : "A reported result is final."
              }`
            : prices
              ? "The simulated market's price for each result, which is its chance of being the single winner."
              : "No result has been reported yet."}
        </p>
        {reported && actions.resetResults && (
          <button
            type="button"
            onClick={actions.resetResults}
            className="mt-3 w-full rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
          >
            Reset results and try another
          </button>
        )}
      </Section>

      {!reported && props.locked && (
        <Section title="Report the result" hint={props.locked}>
          {null}
        </Section>
      )}
      {!reported && !props.locked && (
        <Section
          title="Report the result"
          hint={`When the question is settled, its resolver reports what happened. Positions on it can then be redeemed. ${props.exampleNote}`}
        >
          {custom ? (
            <div className="flex flex-wrap gap-3">
              {condition.outcomes.map((label, outcome) => (
                <label key={label} className="flex flex-col gap-1 text-xs text-muted">
                  {label}
                  <input
                    value={weights[outcome]}
                    onChange={(event) =>
                      setWeights(
                        weights.map((value, other) =>
                          other === outcome ? event.target.value : value,
                        ),
                      )
                    }
                    inputMode="numeric"
                    className="w-20 rounded-md border border-line bg-page px-2 py-1 font-mono text-sm text-ink"
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {condition.outcomes.map((label, outcome) => (
                <Chip
                  key={label}
                  selected={weights[outcome]?.trim() === "1"}
                  onClick={() =>
                    setWeights(
                      condition.outcomes.map((_, other) => (other === outcome ? "1" : "0")),
                    )
                  }
                >
                  {label}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-2 text-sm text-muted">
            {custom
              ? "Weights share the payout: 1 and 3 gives the first result a quarter and the second three quarters. "
              : "Pick the result that happened. "}
            <button
              type="button"
              onClick={() => {
                if (custom) {
                  const winner = Math.max(
                    0,
                    weights.findIndex((weight) => weight.trim() !== "0"),
                  );
                  setWeights(weights.map((_, other) => (other === winner ? "1" : "0")));
                }
                setCustom(!custom);
              }}
              className="text-accent underline"
            >
              {custom ? "Pick a single result instead" : "Share the payout between results"}
            </button>
          </p>
          <button
            type="button"
            onClick={report}
            className="mt-3 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel"
          >
            Report this result
          </button>
        </Section>
      )}
    </Frame>
  );
}

// An amount as it is typed into a field: no thousands separators.
function plainAmount(amount: bigint, decimals: number): string {
  return formatTokenAmount(amount, decimals).replaceAll(",", "");
}

// Shortcuts under an amount field: a quarter, half, three quarters or all of what is available.
function Fractions(props: { max: bigint; decimals: number; onPick: (text: string) => void }) {
  return (
    <div className="mt-1.5 flex gap-1.5">
      {[25n, 50n, 75n, 100n].map((percent) => (
        <button
          key={percent}
          type="button"
          disabled={props.max === 0n}
          onClick={() => props.onPick(plainAmount((props.max * percent) / 100n, props.decimals))}
          className="flex-1 rounded border border-line py-0.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {percent === 100n ? "Max" : `${percent}%`}
        </button>
      ))}
    </div>
  );
}

function SendEditor(props: {
  decimals: number;
  held: bigint;
  onSend: (recipient: string, amount: bigint) => void;
  onFail: (message: string) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState(() => plainAmount(props.held, props.decimals));
  const available = formatTokenAmount(props.held, props.decimals);

  function submit() {
    const amount = attempt(() => {
      const value = text.trim() === "" ? props.held : parseTokenAmount(text, props.decimals);
      if (value <= 0n) throw new RangeError("enter a number of shares");
      if (value > props.held) throw new RangeError(`only ${available} available`);
      return value;
    });
    if (amount.ok) props.onSend(recipient.trim(), amount.value);
    else props.onFail(amount.error);
  }

  const field = "w-0 min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 font-mono";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <input
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
        placeholder="Recipient wallet address"
        aria-label="Recipient wallet address"
        spellCheck={false}
        className={`${field} w-full flex-none text-xs`}
      />
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`all ${available}`}
          aria-label="Shares to send"
          inputMode="decimal"
          className={field}
        />
        <span className="text-muted">shares</span>
        <button
          type="button"
          disabled={recipient.trim() === ""}
          onClick={submit}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
        >
          Send
        </button>
      </div>
      <Fractions max={props.held} decimals={props.decimals} onPick={setText} />
    </div>
  );
}

// Wraps native shares or unwraps tokens, one direction at a time.
function WrapEditor(props: {
  decimals: number;
  held: bigint;
  wrapped: bigint;
  onWrap: (amount: bigint) => void;
  onUnwrap: (amount: bigint) => void;
  onFail: (message: string) => void;
}) {
  const [unwrapping, setUnwrapping] = useState(props.held === 0n);
  const available = unwrapping ? props.wrapped : props.held;
  const [text, setText] = useState(() => plainAmount(available, props.decimals));
  const format = (amount: bigint) => formatTokenAmount(amount, props.decimals);

  function choose(next: boolean) {
    setUnwrapping(next);
    setText(plainAmount(next ? props.wrapped : props.held, props.decimals));
  }

  function submit() {
    const amount = attempt(() => {
      const value = text.trim() === "" ? available : parseTokenAmount(text, props.decimals);
      if (value <= 0n) throw new RangeError("enter a number of shares");
      if (value > available) throw new RangeError(`only ${format(available)} available`);
      return value;
    });
    if (!amount.ok) props.onFail(amount.error);
    else if (unwrapping) props.onUnwrap(amount.value);
    else props.onWrap(amount.value);
  }

  const mode = (active: boolean) =>
    `flex-1 border-b-2 pb-1.5 text-sm font-medium ${active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`;
  return (
    <div>
      <div className="flex gap-4 border-b border-line">
        <button type="button" onClick={() => choose(false)} className={mode(!unwrapping)}>
          Wrap <span className="font-mono text-xs text-muted">{format(props.held)}</span>
        </button>
        <button type="button" onClick={() => choose(true)} className={mode(unwrapping)}>
          Unwrap <span className="font-mono text-xs text-muted">{format(props.wrapped)}</span>
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={unwrapping ? "Shares to unwrap" : "Shares to wrap"}
          inputMode="decimal"
          className="w-0 min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 font-mono"
        />
        <span className="text-muted">shares</span>
        <button
          type="button"
          disabled={available === 0n}
          onClick={submit}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
        >
          {unwrapping ? "Unwrap" : "Wrap"}
        </button>
      </div>
      <Fractions max={available} decimals={props.decimals} onPick={setText} />
    </div>
  );
}

function ActionButton(props: {
  tone: "accent" | "good";
  label: string;
  note: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tone =
    props.tone === "good"
      ? "border-good text-good hover:bg-good-soft"
      : "border-accent text-accent hover:bg-accent-soft";
  return (
    <div>
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
        className={`w-full rounded-md border px-3 py-1.5 text-sm font-medium disabled:border-line disabled:text-muted disabled:hover:bg-transparent ${tone}`}
      >
        {props.label}
      </button>
      <div className="mt-1 text-xs text-muted">{props.note}</div>
    </div>
  );
}

// `factorIndex` set: cut that selection into two pieces. Otherwise: split by `conditionKey`.
type SplitDraft = Readonly<{
  factorIndex: number | null;
  conditionKey: string;
  outcomes: readonly number[];
  shares: string;
}>;

function SplitEditor(props: Workspace & { sourceKey: string }) {
  const { conditions, collateral, actions } = props;
  const { portfolio } = props.ledger;
  const fromWallet = props.sourceKey === COLLATERAL_KEY;
  const source = portfolio.holdings.find((holding) => holding.key === props.sourceKey);
  const factors = source?.factors ?? [];
  const available = source?.amount ?? (fromWallet ? portfolio.collateral : 0n);
  const [draft, setDraft] = useState<SplitDraft>(() => {
    const first = factors.findIndex(
      (factor) => outcomesInIndexSet(factor.indexSet, factor.outcomeCount).length > 1,
    );
    return {
      factorIndex: first === -1 ? null : first,
      conditionKey: conditions[0]!.key,
      outcomes: [],
      shares: plainAmount(available, collateral.decimals),
    };
  });

  if (available === 0n) {
    return (
      <p className="text-sm text-muted">
        {fromWallet
          ? `You have no free ${collateral.symbol} to deposit.`
          : "You hold none of this position, so there is nothing to split."}
      </p>
    );
  }

  const cuttable = factors
    .map((factor, index) => ({ factor, index }))
    .filter(({ factor }) => outcomesInIndexSet(factor.indexSet, factor.outcomeCount).length > 1);
  const cutting = draft.factorIndex === null ? null : factors[draft.factorIndex]!;
  const condition = cutting
    ? findCondition(conditions, cutting.conditionId)
    : (conditions.find((candidate) => candidate.key === draft.conditionKey) ?? conditions[0]!);
  const choices = cutting
    ? outcomesInIndexSet(cutting.indexSet, cutting.outcomeCount)
    : condition.outcomes.map((_, outcome) => outcome);
  const repeats =
    !cutting &&
    factors.some((factor) => toHex(factor.conditionId) === toHex(condition.conditionId));
  const ready = draft.outcomes.length > 0 && draft.outcomes.length < choices.length;
  // Pieces of a repeated question that share no result with the position's own selection.
  const chosen = indexSetFromOutcomes(draft.outcomes);
  const worthless =
    repeats && ready
      ? [chosen, complementIndexSet(condition.outcomes.length, chosen)].filter(
          (piece) =>
            repetition([
              ...factors,
              {
                conditionId: condition.conditionId,
                outcomeCount: condition.outcomes.length,
                indexSet: piece,
              },
            ]) === "exclusive",
        )
      : [];

  function submit() {
    const amount = attempt(() =>
      draft.shares.trim() === "" ? available : parseTokenAmount(draft.shares, collateral.decimals),
    );
    if (!amount.ok) return actions.fail(amount.error);
    const ref = { conditionId: condition.conditionId, outcomeCount: condition.outcomes.length };
    const first = indexSetFromOutcomes(draft.outcomes);
    if (cutting) {
      actions.split(
        factors.filter((_, index) => index !== draft.factorIndex),
        ref,
        [first, subtractIndexSet(cutting.indexSet, first)],
        amount.value,
      );
    } else {
      actions.split(
        factors,
        ref,
        [first, complementIndexSet(condition.outcomes.length, first)],
        amount.value,
      );
    }
  }

  const option = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-left text-sm ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`;

  return (
    <div>
      {cuttable.length > 0 && (
        <div className="mb-3 flex flex-col rounded-lg border border-line p-0.5">
          {cuttable.map(({ factor, index }) => (
            <button
              key={index}
              type="button"
              aria-pressed={draft.factorIndex === index}
              onClick={() => setDraft({ ...draft, factorIndex: index, outcomes: [] })}
              className={option(draft.factorIndex === index)}
            >
              Narrow {findCondition(conditions, factor.conditionId).title}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={draft.factorIndex === null}
            onClick={() => setDraft({ ...draft, factorIndex: null, outcomes: [] })}
            className={option(draft.factorIndex === null)}
          >
            Combine with a question
          </button>
        </div>
      )}

      {!cutting && conditions.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {conditions.map((candidate) => (
            <Chip
              key={candidate.key}
              selected={candidate.key === condition.key}
              onClick={() => setDraft({ ...draft, conditionKey: candidate.key, outcomes: [] })}
            >
              {candidate.title}
            </Chip>
          ))}
        </div>
      )}

      <p className="text-sm text-muted">
        Pick the results for the first piece. The remaining{" "}
        {cutting ? "results of this position" : `results of ${condition.title}`} form the second.
        {repeats &&
          " This question is already part of the position, so using it again multiplies its payout share instead of narrowing it."}
      </p>
      {worthless.length > 0 && (
        <p className="mt-2 rounded-md bg-bad-soft px-2 py-1.5 text-sm text-bad">
          {worthless.map((piece) => `“${describeSubset(condition, piece)}”`).join(" and ")} has no
          result in common with what this position already selects on {condition.title}. That piece
          pays only if the result is reported as shared; with a single winning result it is worth
          nothing.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((outcome) => (
          <Chip
            key={outcome}
            selected={draft.outcomes.includes(outcome)}
            onClick={() =>
              setDraft({
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

      <div className="mt-3 flex items-center gap-2 text-sm">
        <input
          value={draft.shares}
          onChange={(event) => setDraft({ ...draft, shares: event.target.value })}
          placeholder={`all ${formatTokenAmount(available, collateral.decimals)}`}
          aria-label={fromWallet ? `${collateral.symbol} to deposit` : "Shares to split"}
          inputMode="decimal"
          className="w-0 min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 font-mono"
        />
        <span className="text-muted">{fromWallet ? collateral.symbol : "shares"}</span>
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
        >
          {fromWallet ? "Deposit and split" : "Split"}
        </button>
      </div>
      <Fractions
        max={available}
        decimals={collateral.decimals}
        onPick={(shares) => setDraft({ ...draft, shares })}
      />
    </div>
  );
}

function cents(value: number): string {
  return `${Math.round(value * 100)}¢`;
}

// Buys or sells shares of one position: the box it was opened from.
function TradeTicket(props: {
  collateral: Collateral;
  name: string;
  held: bigint;
  members: readonly boolean[];
  free: bigint;
  market: Market;
  onTrade: (shares: bigint, collateral: bigint, market: Market) => void;
}) {
  const { symbol, decimals } = props.collateral;
  const [selling, setSelling] = useState(false);
  // Buying has no natural maximum in shares, so it starts from a round number.
  const [text, setText] = useState("100");
  function choose(next: boolean) {
    setSelling(next);
    setText(next ? plainAmount(props.held, decimals) : "100");
  }
  const format = (amount: bigint) => `${formatTokenAmount(amount, decimals)} ${symbol}`;
  const { members, held } = props;
  const size = attempt(() => {
    const value = parseTokenAmount(text, decimals);
    if (value <= 0n) throw new RangeError("enter a number of shares");
    return { shares: value, count: toMarketAmount(value, decimals) };
  });

  const mode = (active: boolean) =>
    `flex-1 border-b-2 pb-1.5 text-sm font-medium ${active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`;
  let summary: ReactNode = <Badge tone="bad">{size.ok ? "" : size.error}</Badge>;
  if (size.ok) {
    const { shares, count } = size.value;
    const unit = 10 ** decimals;
    // Round against the trader, as a venue would.
    const amount = selling
      ? BigInt(Math.floor(-quote(props.market, members, -count) * unit))
      : BigInt(Math.ceil(quote(props.market, members, count) * unit));
    const blocked = selling
      ? shares > held
        ? `You only hold ${formatTokenAmount(held, decimals)} shares.`
        : null
      : amount > props.free
        ? `You only have ${format(props.free)} free.`
        : null;
    const line = (label: string, value: string, strong = false) => (
      <div className="flex justify-between gap-3">
        <span className="text-muted">{label}</span>
        <span className={`font-mono ${strong ? "font-semibold text-good" : ""}`}>{value}</span>
      </div>
    );
    summary = (
      <>
        <div className="flex flex-col gap-1 text-sm">
          {line("Average price", cents(toNumber(amount, decimals) / count))}
          {line(selling ? "You receive" : "You pay", format(amount))}
          {!selling && line("Pays if right", format(shares), true)}
        </div>
        <button
          type="button"
          disabled={blocked !== null}
          onClick={() =>
            props.onTrade(
              selling ? -shares : shares,
              selling ? amount : -amount,
              buy(props.market, members, selling ? -count : count),
            )
          }
          className={`mt-3 w-full rounded-md px-3 py-2 text-sm font-semibold text-panel disabled:bg-line disabled:text-muted bg-accent`}
        >
          {selling ? "Sell" : "Buy"} {formatTokenAmount(shares, decimals)} shares
        </button>
        {blocked && <p className="mt-1 text-xs text-bad">{blocked}</p>}
      </>
    );
  }

  return (
    <div>
      <div className="flex gap-4 border-b border-line">
        <button type="button" onClick={() => choose(false)} className={mode(!selling)}>
          Buy
        </button>
        <button type="button" onClick={() => choose(true)} className={mode(selling)}>
          Sell
        </button>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{props.name}</span>
        <span className="font-mono text-lg font-semibold">
          {cents(price(props.market, members))}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {selling
          ? `Give up shares of this position and receive ${symbol} now. You hold ${formatTokenAmount(held, decimals)}.`
          : `Pay ${symbol} now for shares of this position. Each pays 1 ${symbol} if it comes true. To bet the other way, select another box.`}
      </p>

      <div className="my-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Shares to trade"
            inputMode="decimal"
            className="w-0 min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 font-mono"
          />
          <span className="text-muted">shares</span>
        </label>
        {selling && <Fractions max={held} decimals={decimals} onPick={setText} />}
      </div>
      {summary}
    </div>
  );
}
