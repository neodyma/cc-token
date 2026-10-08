import assert from "node:assert/strict";
import { test } from "node:test";

import {
  balanceOf,
  COLLATERAL_KEY,
  layoutGraph,
  merge,
  openLedger,
  redeem,
  split,
  trade,
} from "../src/ledger.ts";
import {
  compose,
  holdingKey,
  indexSetFromOutcomes,
  mergeOptions,
  SCENARIOS,
} from "../src/scenario.ts";

function open(key: string, wallet: bigint, deposit: bigint) {
  const scenario = SCENARIOS.find((candidate) => candidate.key === key)!;
  const { plan } = compose(
    scenario.conditions,
    scenario.factors,
    scenario.mode,
    scenario.collateral.mint,
  );
  return { scenario, factors: plan.factors, ledger: openLedger(wallet, plan.factors, deposit) };
}

test("a deposit is drawn as one split per selection", () => {
  const { factors, ledger } = open("governance", 150n, 100n);
  assert.equal(ledger.portfolio.collateral, 50n);
  // Approved splits into the claim and its complement; rejected is the other leaf.
  assert.equal(ledger.nodes.length, 4);
  assert.equal(ledger.edges.length, 4);
  assert.equal(balanceOf(ledger, holdingKey(factors)), 100n);
  assert.equal(balanceOf(ledger, holdingKey(factors.slice(0, 1))), 0n);

  const layout = layoutGraph(ledger);
  assert.equal(layout.columns, 3);
  assert.equal(layout.depth, 3);
  assert.equal(layout.slots.get(COLLATERAL_KEY)!.depth, 0);
  assert.equal(layout.slots.get(holdingKey(factors))!.depth, 2);
});

test("a repeated selection is drawn as a second split of the same question", () => {
  const { factors, ledger } = open("uptime-bond", 100n, 100n);
  assert.equal(factors.length, 2);
  assert.equal(ledger.nodes.length, 4);
  assert.equal(layoutGraph(ledger).depth, 3);
});

test("merging removes the pieces a split drew and restores the graph", () => {
  const { scenario, factors, ledger } = open("tournament", 1_000n, 1_000n);
  const condition = scenario.conditions[0]!;
  const ref = { conditionId: condition.conditionId, outcomeCount: condition.outcomes.length };
  const pairs = [indexSetFromOutcomes([0, 1]), indexSetFromOutcomes([2, 3])];

  const refined = split(ledger, [], ref, pairs, 1_000n);
  assert.equal(refined.nodes.length, 4);
  assert.equal(layoutGraph(refined).depth, 3);

  const target = holdingKey(factors);
  const option = mergeOptions(refined.portfolio).find(
    (candidate) => holdingKey(candidate.result) === target,
  )!;
  const merged = merge(refined, option.parent, option.condition, option.partition, option.amount);
  assert.deepEqual(merged.nodes, ledger.nodes);
  assert.deepEqual(merged.edges, ledger.edges);
  assert.equal(balanceOf(merged, target), 1_000n);
  assert.equal(merged.portfolio.holdings.length, 2);

  // A partly merged piece keeps its place.
  const partly = merge(refined, option.parent, option.condition, option.partition, 400n);
  assert.equal(partly.nodes.length, 4);
});

test("cashing out a full set leaves only collateral", () => {
  const { ledger } = open("price-range", 500n, 500n);
  const option = mergeOptions(ledger.portfolio)[0]!;
  assert.equal(option.result.length, 0);
  const cashed = merge(ledger, option.parent, option.condition, option.partition, option.amount);
  assert.equal(cashed.portfolio.collateral, 500n);
  assert.equal(cashed.nodes.length, 0);
  assert.equal(layoutGraph(cashed).columns, 1);
});

test("a trade moves shares against collateral and rejects overdrafts", () => {
  const { factors, ledger } = open("price-range", 200n, 100n);
  const key = holdingKey(factors);
  const bought = trade(ledger, factors, 50n, -40n);
  assert.equal(balanceOf(bought, key), 150n);
  assert.equal(bought.portfolio.collateral, 60n);
  assert.throws(() => trade(ledger, factors, 50n, -101n));
  assert.throws(() => trade(ledger, factors, -101n, 10n));

  // A position sold down to nothing stays in the graph, so it can be bought back.
  const sold = trade(ledger, factors, -100n, 30n);
  assert.equal(balanceOf(sold, key), 0n);
  assert.equal(sold.nodes.length, ledger.nodes.length);

  // Buying a position that is not on the graph yet draws it.
  const cashed = merge(ledger, ...mergeArguments(ledger));
  assert.equal(cashed.nodes.length, 0);
  const fresh = trade(cashed, factors, 10n, -4n);
  assert.equal(fresh.nodes.length, 1);
  assert.deepEqual(fresh.edges, [{ from: COLLATERAL_KEY, to: key }]);
  assert.throws(() => trade(cashed, factors, -1n, 1n));
});

function mergeArguments(ledger: ReturnType<typeof openLedger>) {
  const option = mergeOptions(ledger.portfolio)[0]!;
  return [option.parent, option.condition, option.partition, option.amount] as const;
}

test("redemption settles one question at a time and floors each step", () => {
  const { factors, ledger } = open("uptime-bond", 100n, 100n);
  const key = holdingKey(factors);
  // A quarter of the month down: the twice-applied selection pays a sixteenth.
  const once = redeem(ledger, key, 1, [1n, 3n]);
  const residual = holdingKey(factors.slice(0, 1));
  assert.equal(balanceOf(once, key), 0n);
  assert.equal(balanceOf(once, residual), 25n);
  assert.ok(!once.nodes.some((node) => node.key === key));

  const twice = redeem(once, residual, 0, [1n, 3n]);
  assert.equal(twice.portfolio.collateral, 6n);
  assert.throws(() => redeem(twice, residual, 0, [1n, 3n]));
});
