import {
  calculatePayout,
  complementIndexSet,
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  payoutRatio,
  planExplicitProduct,
  planLogicalConjunction,
  ROOT_COLLECTION_ID,
  type CollectionCompositionPlan,
  type ConditionClause,
  type IndexSetWords,
  validatePartition,
} from "@cc-token/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { address, getAddressDecoder, type Address, type ReadonlyUint8Array } from "@solana/kit";

export type DemoCondition = Readonly<{
  key: string;
  title: string;
  question: string;
  outcomes: readonly string[];
  // For ordered ranges: the boundary between each result and the next, so that neighbouring
  // results can be described as one range.
  scale?: readonly string[];
  resolver: Address;
  questionId: Uint8Array;
  conditionId: Uint8Array;
}>;

export type Factor = Readonly<{ conditionKey: string; indexSet: IndexSetWords }>;

export type CompositionMode = "logical" | "product";

export type ConstructionPath = Readonly<{
  steps: readonly Readonly<{ clause: ConditionClause; collectionId: Uint8Array }>[];
  collectionId: ReadonlyUint8Array;
}>;

export type Composition = Readonly<{
  plan: CollectionCompositionPlan;
  positionId: Uint8Array | null;
  paths: readonly [ConstructionPath, ConstructionPath];
}>;

export type MintedClaim = Readonly<{ factors: readonly ConditionClause[]; isTarget: boolean }>;

export type Holding = Readonly<{
  key: string;
  factors: readonly ConditionClause[];
  amount: bigint;
}>;

// `collateral` is the part of the deposit that is not locked in any claim.
export type Portfolio = Readonly<{ collateral: bigint; holdings: readonly Holding[] }>;

export type ConditionRef = Readonly<{ conditionId: ReadonlyUint8Array; outcomeCount: number }>;

export type MergeOption = Readonly<{
  parent: readonly ConditionClause[];
  condition: ConditionRef;
  partition: readonly [IndexSetWords, IndexSetWords];
  left: Holding;
  right: Holding;
  result: readonly ConditionClause[];
  amount: bigint;
}>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type RedemptionStep = Readonly<{
  clause: ConditionClause;
  numerator: bigint;
  denominator: bigint;
  input: bigint;
  output: bigint;
}>;

export type Collateral = Readonly<{ symbol: string; mint: Address; decimals: number }>;

export type Scenario = Readonly<{
  key: string;
  title: string;
  summary: string;
  collateral: Collateral;
  conditions: readonly DemoCondition[];
  factors: readonly Factor[];
  mode: CompositionMode;
  payouts: Readonly<Record<string, readonly string[]>>;
  resolution: string;
  deposit: string;
  // What the simulated market believes at the start: relative odds per result of each question.
  odds: Readonly<Record<string, readonly number[]>>;
}>;

// Fixed byte patterns, not real accounts: the demo only derives identifiers.
export const DEMO_RESOLVER: Address = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const DEMO_ABC_MINT: Address = getAddressDecoder().decode(new Uint8Array(32).fill(9));

const USDC: Collateral = {
  symbol: "USDC",
  mint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  decimals: 6,
};

export const SCENARIOS: readonly Scenario[] = [
  {
    key: "price-range",
    title: "Price range",
    summary:
      "One question about the SOL price, split into eight buckets. Any group of buckets is a single claim, so a market maker can sell a $125 to $200 range without anyone creating a new market for it.",
    collateral: USDC,
    conditions: [
      defineCondition(
        "sol-price",
        "SOL/USD at expiry",
        "SOL/USD at 16:00 UTC on 31 December 2026",
        [
          "below $100",
          "$100 to $125",
          "$125 to $150",
          "$150 to $175",
          "$175 to $200",
          "$200 to $225",
          "$225 to $250",
          "$250 or more",
        ],
        ["$100", "$125", "$150", "$175", "$200", "$225", "$250"],
      ),
    ],
    factors: [{ conditionKey: "sol-price", indexSet: indexSetFromOutcomes([2, 3, 4]) }],
    mode: "logical",
    payouts: { "sol-price": ["0", "0", "0", "1", "0", "0", "0", "0"] },
    resolution: "SOL settles at $162, inside the range.",
    deposit: "10000",
    odds: { "sol-price": [5, 10, 14, 14, 12, 15, 15, 15] },
  },
  {
    key: "governance",
    title: "Governance and price",
    summary:
      "ABC is a made-up DAO token. Its holders split it by two independent questions: does the buyback proposal pass, and is SOL at $200 or more. The claim pays only if both happen, and it is backed by the DAO token itself instead of a stablecoin.",
    collateral: { symbol: "ABC", mint: DEMO_ABC_MINT, decimals: 6 },
    conditions: [
      defineCondition(
        "buyback",
        "Buyback proposal",
        "ABC DAO votes on a $10 million token buyback",
        ["approved", "rejected"],
      ),
      defineCondition("sol-level", "SOL/USD at expiry", "SOL/USD at the proposal's expiry", [
        "$200 or more",
        "below $200",
      ]),
    ],
    factors: [
      { conditionKey: "buyback", indexSet: indexSetFromOutcomes([0]) },
      { conditionKey: "sol-level", indexSet: indexSetFromOutcomes([0]) },
    ],
    mode: "logical",
    payouts: { buyback: ["1", "0"], "sol-level": ["0", "1"] },
    resolution: "The buyback is approved, but SOL finishes below $200.",
    deposit: "50000",
    odds: { buyback: [1, 1], "sol-level": [1, 1] },
  },
  {
    key: "price-volatility",
    title: "Price and volatility",
    summary:
      "A price range claim that also depends on the volatility regime: it pays only if SOL finishes below $150 and volatility is high. Two different kinds of question are combined into one asset.",
    collateral: USDC,
    conditions: [
      defineCondition(
        "sol-quartile",
        "SOL/USD at expiry",
        "SOL/USD at 16:00 UTC on 31 December 2026",
        ["below $125", "$125 to $150", "$150 to $200", "$200 or more"],
        ["$125", "$150", "$200"],
      ),
      defineCondition(
        "volatility",
        "Volatility regime",
        "30-day realised SOL volatility at 16:00 UTC on 31 December 2026",
        ["high", "low"],
      ),
    ],
    factors: [
      { conditionKey: "sol-quartile", indexSet: indexSetFromOutcomes([0, 1]) },
      { conditionKey: "volatility", indexSet: indexSetFromOutcomes([0]) },
    ],
    mode: "logical",
    payouts: { "sol-quartile": ["0", "1", "0", "0"], volatility: ["1", "1"] },
    resolution:
      "SOL settles at $140 and the volatility result is split evenly between high and low.",
    deposit: "100",
    odds: { "sol-quartile": [20, 30, 30, 20], volatility: [3, 2] },
  },
  {
    key: "tournament",
    title: "Tournament winner",
    summary:
      "Eight teams, one winner. Early on, a broad claim on half the field is easy to price and trade. As the tournament narrows, the same shares can be cut into smaller groups and finally single teams, without anyone opening a new market.",
    collateral: USDC,
    conditions: [
      defineCondition("winner", "Tournament winner", "Which team wins the final", [
        "Lions",
        "Tigers",
        "Bears",
        "Wolves",
        "Hawks",
        "Eagles",
        "Sharks",
        "Bulls",
      ]),
    ],
    factors: [{ conditionKey: "winner", indexSet: indexSetFromOutcomes([0, 1, 2, 3]) }],
    mode: "logical",
    payouts: { winner: ["0", "1", "0", "0", "0", "0", "0", "0"] },
    resolution: "The Tigers win the final.",
    deposit: "1000",
    odds: { winner: [15, 12, 10, 8, 20, 15, 12, 8] },
  },
  {
    key: "uptime-bond",
    title: "Uptime bond",
    summary:
      "An RPC provider posts a bond that pays its customer the square of the monthly downtime fraction, so the payout grows faster the worse the outage. The same selection is applied twice on purpose.",
    collateral: USDC,
    conditions: [
      defineCondition(
        "downtime",
        "Monthly downtime",
        "Share of the month the RPC service was down",
        ["downtime", "uptime"],
      ),
    ],
    factors: [
      { conditionKey: "downtime", indexSet: indexSetFromOutcomes([0]) },
      { conditionKey: "downtime", indexSet: indexSetFromOutcomes([0]) },
    ],
    mode: "product",
    payouts: { downtime: ["1", "3"] },
    resolution:
      "The service was down 25% of the month, reported as weight 1 on downtime and 3 on uptime: a quarter and three quarters.",
    deposit: "10000",
    odds: { downtime: [1, 19] },
  },
];

export function defineCondition(
  key: string,
  title: string,
  question: string,
  outcomes: readonly string[],
  scale?: readonly string[],
): DemoCondition {
  if (scale && scale.length !== outcomes.length - 1) {
    throw new RangeError("a scale has one boundary between each pair of results");
  }
  const questionId = keccak_256(new TextEncoder().encode(JSON.stringify({ question, outcomes })));
  return {
    key,
    title,
    question,
    outcomes,
    ...(scale ? { scale } : {}),
    resolver: DEMO_RESOLVER,
    questionId,
    conditionId: deriveConditionId(DEMO_RESOLVER, questionId, outcomes.length),
  };
}

export function indexSetFromOutcomes(outcomes: readonly number[]): IndexSetWords {
  const words: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  for (const outcome of outcomes) {
    if (!Number.isInteger(outcome) || outcome < 0 || outcome > 255) {
      throw new RangeError("outcome must be between 0 and 255");
    }
    words[Math.floor(outcome / 64)]! |= 1n << BigInt(outcome % 64);
  }
  return words;
}

export function outcomesInIndexSet(indexSet: IndexSetWords, outcomeCount: number): number[] {
  const outcomes: number[] = [];
  for (let outcome = 0; outcome < outcomeCount; outcome += 1) {
    if ((indexSet[Math.floor(outcome / 64)]! & (1n << BigInt(outcome % 64))) !== 0n) {
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

function describeOutcomes(condition: DemoCondition, outcomes: readonly number[]): string {
  const { scale } = condition;
  if (!scale) return outcomes.map((outcome) => condition.outcomes[outcome]).join(" or ");
  const last = condition.outcomes.length - 1;
  const runs: [number, number][] = [];
  for (const outcome of outcomes) {
    const run = runs[runs.length - 1];
    if (run && run[1] === outcome - 1) run[1] = outcome;
    else runs.push([outcome, outcome]);
  }
  return runs
    .map(([from, to]) =>
      from === 0
        ? `below ${scale[to]}`
        : to === last
          ? `${scale[from - 1]} or more`
          : `${scale[from - 1]} to ${scale[to]}`,
    )
    .join(" or ");
}

// Neighbouring ranges are joined, and a selection of most results is named by what it leaves out.
export function describeSubset(condition: DemoCondition, indexSet: IndexSetWords): string {
  const count = condition.outcomes.length;
  const selected = outcomesInIndexSet(indexSet, count);
  if (selected.length >= 3 && selected.length < count && selected.length > count / 2) {
    const rest = condition.outcomes
      .map((_, outcome) => outcome)
      .filter((outcome) => !selected.includes(outcome));
    return `anything except ${describeOutcomes(condition, rest)}`;
  }
  return describeOutcomes(condition, selected);
}

// The statement a position pays on, as a clause: "X is a, and Y is b".
export function claimStatement(
  conditions: readonly DemoCondition[],
  factors: readonly ConditionClause[],
): string {
  return factors
    .map((factor) => {
      const condition = findCondition(conditions, factor.conditionId);
      return `${condition.title} is ${describeSubset(condition, factor.indexSet)}`;
    })
    .join(", and ");
}

// One sentence saying when a share pays.
export function explainClaim(
  conditions: readonly DemoCondition[],
  factors: readonly ConditionClause[],
  symbol: string,
): string {
  const parts = factors.map((factor) => {
    const condition = findCondition(conditions, factor.conditionId);
    return `${condition.title} is ${describeSubset(condition, factor.indexSet)}`;
  });
  const repeated =
    new Set(factors.map((factor) => toHex(factor.conditionId))).size < factors.length;
  return repeated
    ? `Each share pays up to 1 ${symbol}: the payout share of “${parts.join("” multiplied by that of “")}”. A question used more than once multiplies its own share.`
    : `Each share pays 1 ${symbol} if ${parts.join(", and ")}. Otherwise it pays nothing. If a result is reported as shared, it pays that share.`;
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

export function toHex(bytes: ReadonlyUint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function findCondition(
  conditions: readonly DemoCondition[],
  conditionId: ReadonlyUint8Array,
): DemoCondition {
  const key = toHex(conditionId);
  const condition = conditions.find((candidate) => toHex(candidate.conditionId) === key);
  if (!condition) throw new Error("unknown condition");
  return condition;
}

export function compose(
  conditions: readonly DemoCondition[],
  factors: readonly Factor[],
  mode: CompositionMode,
  collateralMint: Address,
): Composition {
  const clauses = factors.map((factor) => {
    const condition = conditions.find((candidate) => candidate.key === factor.conditionKey);
    if (!condition) throw new Error("unknown condition");
    return {
      conditionId: condition.conditionId,
      outcomeCount: condition.outcomes.length,
      indexSet: factor.indexSet,
    };
  });
  const plan = mode === "logical" ? planLogicalConjunction(clauses) : planExplicitProduct(clauses);
  const isRoot = plan.steps.length === 0;
  return {
    plan,
    positionId: isRoot ? null : derivePositionId(collateralMint, plan.collectionId),
    paths: [constructionPath(plan.factors), constructionPath([...plan.factors].reverse())],
  };
}

export function constructionPath(factors: readonly ConditionClause[]): ConstructionPath {
  let collectionId: Uint8Array = ROOT_COLLECTION_ID;
  const steps = factors.map((clause) => {
    collectionId = deriveCollectionId(
      collectionId,
      clause.conditionId,
      clause.indexSet,
    ).collectionId;
    return { clause, collectionId };
  });
  return { steps, collectionId };
}

// One floor per factor, in the order given, matching one-factor redemption on-chain.
export function simulateRedemption(
  factors: readonly ConditionClause[],
  payoutNumerators: (conditionId: ReadonlyUint8Array) => readonly bigint[],
  amount: bigint,
): readonly RedemptionStep[] {
  let remaining = amount;
  return factors.map((clause) => {
    const ratio = payoutRatio(payoutNumerators(clause.conditionId), clause.indexSet);
    const input = remaining;
    remaining = calculatePayout(input, ratio.numerator, ratio.denominator);
    return { clause, ...ratio, input, output: remaining };
  });
}

// Building the target one split at a time leaves the holder with one complement per factor
// plus the target. Together they are worth exactly the deposit.
export function mintedSet(factors: readonly ConditionClause[]): readonly MintedClaim[] {
  if (factors.length === 0) return [];
  const complements = factors.map((factor, index) => ({
    factors: [
      ...factors.slice(0, index),
      { ...factor, indexSet: complementIndexSet(factor.outcomeCount, factor.indexSet) },
    ],
    isTarget: false,
  }));
  return [...complements, { factors, isTarget: true }];
}

export function parseTokenAmount(text: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) throw new RangeError(`"${text}" is not an amount`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new RangeError(`amounts have at most ${decimals} decimal places`);
  }
  return BigInt(match[1]! + fraction.padEnd(decimals, "0"));
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const digits = amount.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  const whole = digits.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function attempt<T>(run: () => T): Result<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function holdingKey(factors: readonly ConditionClause[]): string {
  return toHex(constructionPath(factors).collectionId);
}

export function adjustBalance(
  portfolio: Portfolio,
  factors: readonly ConditionClause[],
  change: bigint,
): Portfolio {
  if (factors.length === 0) {
    const collateral = portfolio.collateral + change;
    if (collateral < 0n) throw new RangeError("not enough unlocked collateral");
    return { ...portfolio, collateral };
  }
  const key = holdingKey(factors);
  const existing = portfolio.holdings.find((holding) => holding.key === key);
  const amount = (existing?.amount ?? 0n) + change;
  if (amount < 0n) throw new RangeError("not enough shares of that claim");
  const holdings = existing
    ? portfolio.holdings.map((holding) => (holding.key === key ? { ...holding, amount } : holding))
    : [...portfolio.holdings, { key, factors, amount }];
  return { ...portfolio, holdings: holdings.filter((holding) => holding.amount > 0n) };
}

// A full partition consumes the parent itself (or collateral at the root); a partial one
// consumes the claim on the union of its pieces.
export function partitionSource(
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
): readonly ConditionClause[] {
  const { union, isFull } = validatePartition(condition.outcomeCount, partition);
  return isFull ? parent : [...parent, { ...condition, indexSet: union }];
}

export function splitPosition(
  portfolio: Portfolio,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Portfolio {
  if (amount <= 0n) throw new RangeError("amount must be greater than zero");
  let next = adjustBalance(portfolio, partitionSource(parent, condition, partition), -amount);
  for (const indexSet of partition) {
    next = adjustBalance(next, [...parent, { ...condition, indexSet }], amount);
  }
  return next;
}

export function mergePositions(
  portfolio: Portfolio,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Portfolio {
  if (amount <= 0n) throw new RangeError("amount must be greater than zero");
  let next = portfolio;
  for (const indexSet of partition) {
    next = adjustBalance(next, [...parent, { ...condition, indexSet }], -amount);
  }
  return adjustBalance(next, partitionSource(parent, condition, partition), amount);
}

// Two holdings merge when they differ in exactly one factor of the same condition and those
// two subsets do not overlap.
export function mergeOptions(portfolio: Portfolio): readonly MergeOption[] {
  const options: MergeOption[] = [];
  const { holdings } = portfolio;
  for (let i = 0; i < holdings.length; i += 1) {
    for (let j = i + 1; j < holdings.length; j += 1) {
      const option = mergeOption(holdings[i]!, holdings[j]!);
      if (option) options.push(option);
    }
  }
  return options;
}

function mergeOption(left: Holding, right: Holding): MergeOption | null {
  if (left.factors.length !== right.factors.length) return null;
  for (let a = 0; a < left.factors.length; a += 1) {
    const leftFactor = left.factors[a]!;
    const parent = left.factors.filter((_, index) => index !== a);
    const parentKey = holdingKey(parent);
    for (let b = 0; b < right.factors.length; b += 1) {
      const rightFactor = right.factors[b]!;
      if (toHex(leftFactor.conditionId) !== toHex(rightFactor.conditionId)) continue;
      if (leftFactor.indexSet.some((word, index) => (word & rightFactor.indexSet[index]!) !== 0n)) {
        continue;
      }
      if (holdingKey(right.factors.filter((_, index) => index !== b)) !== parentKey) continue;
      const condition = {
        conditionId: leftFactor.conditionId,
        outcomeCount: leftFactor.outcomeCount,
      };
      const partition = [leftFactor.indexSet, rightFactor.indexSet] as const;
      return {
        parent,
        condition,
        partition,
        left,
        right,
        result: partitionSource(parent, condition, partition),
        amount: left.amount < right.amount ? left.amount : right.amount,
      };
    }
  }
  return null;
}

export function subtractIndexSet(from: IndexSetWords, remove: IndexSetWords): IndexSetWords {
  return [from[0] & ~remove[0], from[1] & ~remove[1], from[2] & ~remove[2], from[3] & ~remove[3]];
}
