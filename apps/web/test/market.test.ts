import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buy,
  claimAtoms,
  extendMarket,
  openMarket,
  outcomePrices,
  price,
  quote,
  toMarketAmount,
} from "../src/market.ts";
import { compose, SCENARIOS } from "../src/scenario.ts";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

function open(key: string) {
  const scenario = SCENARIOS.find((candidate) => candidate.key === key)!;
  const { plan } = compose(
    scenario.conditions,
    scenario.factors,
    scenario.mode,
    scenario.collateral.mint,
  );
  const market = openMarket(scenario.conditions, scenario.odds, 1_000);
  return { scenario, market, members: claimAtoms(market, scenario.conditions, plan.factors) };
}

test("opening prices follow the scenario odds", () => {
  const range = open("price-range");
  near(price(range.market, range.members), 0.4);
  near(outcomePrices(range.market, 0)[0]!, 0.05);

  // Independent questions multiply.
  const combined = open("price-volatility");
  assert.equal(combined.market.atoms.length, 8);
  near(price(combined.market, combined.members), 0.3);
  near(outcomePrices(combined.market, 1)[0]!, 0.6);
});

test("every scenario opens a market that prices its claim", () => {
  for (const scenario of SCENARIOS) {
    const { market, members } = open(scenario.key);
    const value = price(market, members);
    assert.ok(value > 0 && value < 1, scenario.key);
    near(
      outcomePrices(market, 0).reduce((sum, part) => sum + part, 0),
      1,
    );
  }
});

test("buying raises the price and costs between the old and new price", () => {
  const { market, members } = open("price-range");
  const before = price(market, members);
  const cost = quote(market, members, 100);
  const after = price(buy(market, members, 100), members);
  assert.ok(after > before);
  assert.ok(cost > 100 * before && cost < 100 * after);
});

test("selling straight back returns what was paid", () => {
  const { market, members } = open("governance");
  const cost = quote(market, members, 250);
  const proceeds = -quote(buy(market, members, 250), members, -250);
  near(proceeds, cost);
});

test("a claim and its complement always cost one unit of collateral together", () => {
  const { market, members } = open("tournament");
  const rest = members.map((member) => !member);
  near(price(market, members) + price(market, rest), 1);
  near(quote(market, members, 40) + quote(buy(market, members, 40), rest, 40), 40);
});

test("adding a question keeps existing prices and starts it at even odds", () => {
  const { market, members } = open("price-range");
  const traded = buy(market, members, 300);
  const extended = extendMarket(traded, 4);
  assert.equal(extended.atoms.length, 32);
  near(outcomePrices(extended, 0)[3]!, outcomePrices(traded, 0)[3]!);
  near(outcomePrices(extended, 1)[2]!, 0.25);
});

test("amounts too large for floating point are refused, not rounded", () => {
  assert.equal(toMarketAmount(1_500_000n, 6), 1.5);
  assert.equal(toMarketAmount(BigInt(Number.MAX_SAFE_INTEGER), 0), Number.MAX_SAFE_INTEGER);
  assert.throws(() => toMarketAmount(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0), /too large/);
});
