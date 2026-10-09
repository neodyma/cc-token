import {
  calculatePayout,
  complementIndexSet,
  payoutRatio,
  type ConditionClause,
  type IndexSetWords,
} from "@cc-token/sdk";

import {
  adjustBalance,
  holdingKey,
  mergePositions,
  partitionSource,
  splitPosition,
  type ConditionRef,
  type Portfolio,
} from "./scenario.ts";

export type PositionNode = Readonly<{ key: string; factors: readonly ConditionClause[] }>;

export type Edge = Readonly<{ from: string; to: string }>;

// Balances plus the splits that produced them, so the positions can be drawn as a graph.
// The collateral itself is the root and has no entry in `nodes`.
export type Ledger = Readonly<{
  portfolio: Portfolio;
  nodes: readonly PositionNode[];
  edges: readonly Edge[];
}>;

export type GraphLayout = Readonly<{
  slots: ReadonlyMap<string, Readonly<{ column: number; depth: number }>>;
  columns: number;
  depth: number;
}>;

export const COLLATERAL_KEY = holdingKey([]);

export function balanceOf(ledger: Ledger, key: string): bigint {
  if (key === COLLATERAL_KEY) return ledger.portfolio.collateral;
  return ledger.portfolio.holdings.find((holding) => holding.key === key)?.amount ?? 0n;
}

function withNode(ledger: Ledger, factors: readonly ConditionClause[]): Ledger {
  const key = holdingKey(factors);
  if (key === COLLATERAL_KEY || ledger.nodes.some((node) => node.key === key)) return ledger;
  return { ...ledger, nodes: [...ledger.nodes, { key, factors }] };
}

function withEdge(ledger: Ledger, from: string, to: string): Ledger {
  if (ledger.edges.some((edge) => edge.from === from && edge.to === to)) return ledger;
  return { ...ledger, edges: [...ledger.edges, { from, to }] };
}

// A position that was never split from anything shown hangs directly off the collateral.
function withAnchoredNode(ledger: Ledger, factors: readonly ConditionClause[]): Ledger {
  const key = holdingKey(factors);
  if (key === COLLATERAL_KEY || ledger.nodes.some((node) => node.key === key)) return ledger;
  return withEdge(withNode(ledger, factors), COLLATERAL_KEY, key);
}

export function openLedger(
  wallet: bigint,
  factors: readonly ConditionClause[],
  deposit: bigint,
): Ledger {
  let ledger: Ledger = { portfolio: { collateral: wallet, holdings: [] }, nodes: [], edges: [] };
  factors.forEach((factor, index) => {
    ledger = split(
      ledger,
      factors.slice(0, index),
      factor,
      [factor.indexSet, complementIndexSet(factor.outcomeCount, factor.indexSet)],
      deposit,
    );
  });
  return ledger;
}

export function split(
  ledger: Ledger,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Ledger {
  const portfolio = splitPosition(ledger.portfolio, parent, condition, partition, amount);
  const source = partitionSource(parent, condition, partition);
  let next = withAnchoredNode({ ...ledger, portfolio }, source);
  for (const indexSet of partition) {
    const child = [...parent, { ...condition, indexSet }];
    next = withEdge(withNode(next, child), holdingKey(source), holdingKey(child));
  }
  return next;
}

export function merge(
  ledger: Ledger,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Ledger {
  const portfolio = mergePositions(ledger.portfolio, parent, condition, partition, amount);
  const result = partitionSource(parent, condition, partition);
  const inputs = partition.map((indexSet) => holdingKey([...parent, { ...condition, indexSet }]));
  let next = withAnchoredNode({ ...ledger, portfolio }, result);
  // A used-up piece that leads nowhere else disappears, undoing the split that drew it.
  const spent = inputs.filter(
    (key) => balanceOf(next, key) === 0n && !next.edges.some((edge) => edge.from === key),
  );
  next = {
    ...next,
    nodes: next.nodes.filter((node) => !spent.includes(node.key)),
    edges: next.edges.filter((edge) => !spent.includes(edge.to)),
  };
  for (const key of inputs) {
    if (!spent.includes(key)) next = withEdge(next, holdingKey(result), key);
  }
  return next;
}

// A market trade: positive `shares` and negative `collateral` is a purchase. A position bought
// for the first time is drawn under the position it narrows, when that one is on the graph.
export function trade(
  ledger: Ledger,
  factors: readonly ConditionClause[],
  shares: bigint,
  collateral: bigint,
): Ledger {
  const key = holdingKey(factors);
  if (key === COLLATERAL_KEY) throw new RangeError("unknown position");
  let next = ledger;
  if (!ledger.nodes.some((node) => node.key === key)) {
    const parent = holdingKey(factors.slice(0, -1));
    const from = ledger.nodes.some((node) => node.key === parent) ? parent : COLLATERAL_KEY;
    next = withEdge(withNode(ledger, factors), from, key);
  }
  const paid = adjustBalance(next.portfolio, [], collateral);
  return { ...next, portfolio: adjustBalance(paid, factors, shares) };
}

// What redeeming one factor of a position gives: its residual position, or collateral.
export function redemption(
  ledger: Ledger,
  key: string,
  factorIndex: number,
  numerators: readonly bigint[],
): Readonly<{
  input: bigint;
  output: bigint;
  numerator: bigint;
  denominator: bigint;
  residual: readonly ConditionClause[];
}> {
  const node = ledger.nodes.find((candidate) => candidate.key === key);
  const factor = node?.factors[factorIndex];
  if (!node || !factor) throw new RangeError("unknown position");
  const input = balanceOf(ledger, key);
  const ratio = payoutRatio(numerators, factor.indexSet);
  return {
    input,
    output: calculatePayout(input, ratio.numerator, ratio.denominator),
    ...ratio,
    residual: node.factors.filter((_, index) => index !== factorIndex),
  };
}

// One-factor redemption of everything held, as the program does it: one floor per step.
export function redeem(
  ledger: Ledger,
  key: string,
  factorIndex: number,
  numerators: readonly bigint[],
): Ledger {
  const { input, output, residual } = redemption(ledger, key, factorIndex, numerators);
  if (input === 0n) throw new RangeError("nothing to redeem");
  const node = ledger.nodes.find((candidate) => candidate.key === key)!;
  const debited = adjustBalance(ledger.portfolio, node.factors, -input);
  let next: Ledger = { ...ledger, portfolio: adjustBalance(debited, residual, output) };
  if (output > 0n) next = withAnchoredNode(next, residual);
  // Once results are in, boxes with nothing left in or under them are only clutter.
  for (;;) {
    const spent = next.nodes.find(
      (candidate) =>
        balanceOf(next, candidate.key) === 0n &&
        !next.edges.some((edge) => edge.from === candidate.key),
    );
    if (!spent) return next;
    next = {
      ...next,
      nodes: next.nodes.filter((candidate) => candidate !== spent),
      edges: next.edges.filter((edge) => edge.to !== spent.key),
    };
  }
}

// Each node sits under the first position it was split from; leaves take one column each and
// a parent is centred over its children.
export function layoutGraph(ledger: Ledger): GraphLayout {
  const children = new Map<string, string[]>();
  const placed = new Set<string>([COLLATERAL_KEY]);
  for (const edge of ledger.edges) {
    if (placed.has(edge.to)) continue;
    placed.add(edge.to);
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }

  const slots = new Map<string, { column: number; depth: number }>();
  let columns = 0;
  let deepest = 0;
  const place = (key: string, depth: number): number => {
    deepest = Math.max(deepest, depth);
    const below = (children.get(key) ?? []).map((child) => place(child, depth + 1));
    const column =
      below.length === 0 ? (columns += 1) - 1 : (below[0]! + below[below.length - 1]!) / 2;
    slots.set(key, { column, depth });
    return column;
  };
  place(COLLATERAL_KEY, 0);
  return { slots, columns, depth: deepest + 1 };
}
