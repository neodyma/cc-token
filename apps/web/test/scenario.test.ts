import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adjustBalance,
  compose,
  defineCondition,
  describeSubset,
  formatTokenAmount,
  MAX_U64,
  parsePayoutWeight,
  indexSetFromOutcomes,
  mergeOptions,
  mergePositions,
  mintedSet,
  outcomesInIndexSet,
  SCENARIOS,
  parseTokenAmount,
  simulateRedemption,
  splitPosition,
  toHex,
  type Factor,
} from "../src/scenario.ts";
import { openLedger } from "../src/ledger.ts";

const DEMO_CONDITIONS = [
  defineCondition("sol-price", "SOL/USD at expiry", "SOL/USD at expiry", [
    "below $125",
    "$125 to $150",
    "$150 to $200",
    "$200 or more",
  ]),
  defineCondition("volatility", "Volatility regime", "Volatility at expiry", ["high", "low"]),
];
const DEMO_COLLATERAL = SCENARIOS[0]!.collateral;
const [price, volatility] = DEMO_CONDITIONS;
const lowerHalf: Factor = { conditionKey: "sol-price", indexSet: indexSetFromOutcomes([0, 1]) };
const highVolatility: Factor = { conditionKey: "volatility", indexSet: indexSetFromOutcomes([0]) };

test("index sets round-trip across word boundaries", () => {
  const outcomes = [0, 63, 64, 127, 128, 255];
  assert.deepEqual(outcomesInIndexSet(indexSetFromOutcomes(outcomes), 256), outcomes);
  assert.equal(describeSubset(price!, lowerHalf.indexSet), "below $125 or $125 to $150");
});

test("both construction orders reach the planned collection", () => {
  const forward = compose(
    DEMO_CONDITIONS,
    [lowerHalf, highVolatility],
    "product",
    DEMO_COLLATERAL.mint,
  );
  const reversed = compose(
    DEMO_CONDITIONS,
    [highVolatility, lowerHalf],
    "product",
    DEMO_COLLATERAL.mint,
  );
  const planned = toHex(forward.plan.collectionId);

  assert.equal(toHex(reversed.plan.collectionId), planned);
  assert.equal(toHex(forward.paths[0].collectionId), planned);
  assert.equal(toHex(forward.paths[1].collectionId), planned);
  assert.notEqual(
    toHex(forward.paths[0].steps[0]!.collectionId),
    toHex(forward.paths[1].steps[0]!.collectionId),
  );
  assert.equal(toHex(forward.positionId!), toHex(reversed.positionId!));
});

test("logical mode intersects and product mode keeps repeated factors", () => {
  const upperThree: Factor = {
    conditionKey: "sol-price",
    indexSet: indexSetFromOutcomes([1, 2, 3]),
  };
  const logical = compose(
    DEMO_CONDITIONS,
    [lowerHalf, upperThree],
    "logical",
    DEMO_COLLATERAL.mint,
  );
  const product = compose(
    DEMO_CONDITIONS,
    [lowerHalf, upperThree],
    "product",
    DEMO_COLLATERAL.mint,
  );

  assert.equal(logical.plan.factors.length, 1);
  assert.deepEqual(outcomesInIndexSet(logical.plan.factors[0]!.indexSet, 4), [1]);
  assert.equal(product.plan.factors.length, 2);
  assert.notEqual(toHex(logical.plan.collectionId), toHex(product.plan.collectionId));
});

test("a tautology leaves the collateral root without a position", () => {
  const everything: Factor = { conditionKey: "volatility", indexSet: indexSetFromOutcomes([0, 1]) };
  const composition = compose(DEMO_CONDITIONS, [everything], "logical", DEMO_COLLATERAL.mint);
  assert.equal(composition.plan.steps.length, 0);
  assert.equal(composition.positionId, null);
});

test("redemption floors once per factor", () => {
  const { plan } = compose(
    DEMO_CONDITIONS,
    [lowerHalf, highVolatility],
    "product",
    DEMO_COLLATERAL.mint,
  );
  const payouts = new Map([
    [toHex(price!.conditionId), [1n, 1n, 1n, 1n]],
    [toHex(volatility!.conditionId), [1n, 1n]],
  ]);
  const steps = simulateRedemption(plan.factors, (id) => payouts.get(toHex(id))!, 101n);

  assert.deepEqual(
    steps.map((step) => step.output),
    [50n, 25n],
  );
});

test("the minted set always returns the deposit under exact payouts", () => {
  const { plan } = compose(
    DEMO_CONDITIONS,
    [lowerHalf, highVolatility],
    "product",
    DEMO_COLLATERAL.mint,
  );
  const claims = mintedSet(plan.factors);
  assert.equal(claims.length, 3);
  assert.equal(claims.filter((claim) => claim.isTarget).length, 1);

  for (const priceWeights of [
    [1n, 0n, 0n, 0n],
    [0n, 0n, 1n, 0n],
    [1n, 1n, 1n, 1n],
  ]) {
    for (const volatilityWeights of [
      [1n, 0n],
      [0n, 1n],
      [1n, 1n],
    ]) {
      const payouts = new Map([
        [toHex(price!.conditionId), priceWeights],
        [toHex(volatility!.conditionId), volatilityWeights],
      ]);
      const total = claims
        .map((claim) =>
          simulateRedemption(claim.factors, (id) => payouts.get(toHex(id))!, 100_000_000n),
        )
        .reduce((sum, steps) => sum + steps[steps.length - 1]!.output, 0n);
      assert.equal(total, 100_000_000n);
    }
  }
});

test("token amounts parse and format without losing precision", () => {
  assert.equal(parseTokenAmount("100", 6), 100_000_000n);
  assert.equal(parseTokenAmount("0.30", 6), 300_000n);
  assert.equal(formatTokenAmount(100_000_000n, 6), "100");
  assert.equal(formatTokenAmount(300_001n, 6), "0.300001");
  assert.equal(formatTokenAmount(0n, 6), "0");
  assert.equal(formatTokenAmount(12_345_678_500_000n, 6), "12,345,678.5");
  assert.throws(() => parseTokenAmount("1.0000001", 6));
  assert.throws(() => parseTokenAmount("-1", 6));
  assert.equal(formatTokenAmount(123n, 0), "123");
  assert.equal(formatTokenAmount(1_234_567n, 0), "1,234,567");
  assert.equal(parseTokenAmount("42", 0), 42n);
});

test("amounts and payout weights stay within the program's u64", () => {
  assert.equal(parseTokenAmount("18446744073709551615", 0), MAX_U64);
  assert.throws(() => parseTokenAmount("18446744073709551616", 0), /larger than the program/);
  assert.throws(() => parseTokenAmount("18446744073710", 6), /larger than the program/);
  assert.equal(parsePayoutWeight(" 3 "), 3n);
  assert.equal(parsePayoutWeight("18446744073709551615"), MAX_U64);
  assert.throws(() => parsePayoutWeight("18446744073709551616"), /larger than the program/);
  assert.throws(() => parsePayoutWeight("1.5"), /whole numbers/);
  assert.throws(() => adjustBalance({ collateral: MAX_U64, holdings: [] }, [], 1n));
});

test("every scenario composes and its minted set returns the deposit", () => {
  for (const scenario of SCENARIOS) {
    const { plan, positionId } = compose(
      scenario.conditions,
      scenario.factors,
      scenario.mode,
      scenario.collateral.mint,
    );
    assert.notEqual(positionId, null, scenario.key);

    const deposit = parseTokenAmount(scenario.deposit, scenario.collateral.decimals);
    const weights = (id: Parameters<typeof toHex>[0]) =>
      scenario.payouts[
        scenario.conditions.find((condition) => toHex(condition.conditionId) === toHex(id))!.key
      ]!.map(BigInt);
    const total = mintedSet(plan.factors)
      .map((claim) => simulateRedemption(claim.factors, weights, deposit))
      .reduce((sum, steps) => sum + steps[steps.length - 1]!.output, 0n);
    assert.equal(total, deposit, scenario.key);
  }
});

test("the uptime bond pays the square of the downtime fraction", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.key === "uptime-bond")!;
  const { plan } = compose(
    scenario.conditions,
    scenario.factors,
    "product",
    scenario.collateral.mint,
  );
  const steps = simulateRedemption(plan.factors, () => [1n, 3n], parseTokenAmount("10000", 6));
  assert.equal(formatTokenAmount(steps[steps.length - 1]!.output, 6), "625");

  const logical = compose(
    scenario.conditions,
    scenario.factors,
    "logical",
    scenario.collateral.mint,
  );
  assert.equal(logical.plan.factors.length, 1);
});

test("splits refine a claim and merges restore the original holdings", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.key === "tournament")!;
  const condition = scenario.conditions[0]!;
  const ref = { conditionId: condition.conditionId, outcomeCount: condition.outcomes.length };
  const { plan } = compose(
    scenario.conditions,
    scenario.factors,
    "logical",
    scenario.collateral.mint,
  );
  const start = openLedger(1_000n, plan.factors, 1_000n).portfolio;
  assert.equal(start.holdings.length, 2);

  const pairs = [indexSetFromOutcomes([0, 1]), indexSetFromOutcomes([2, 3])];
  const refined = splitPosition(start, [], ref, pairs, 400n);
  assert.deepEqual(
    refined.holdings.map((holding) => holding.amount),
    [600n, 1_000n, 400n, 400n],
  );

  const singles = [indexSetFromOutcomes([0]), indexSetFromOutcomes([1])];
  const deeper = splitPosition(refined, [], ref, singles, 400n);
  assert.equal(deeper.holdings.length, 5);
  assert.throws(() => splitPosition(deeper, [], ref, singles, 1n));

  const weights = () => [0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n];
  const worth = (portfolio: typeof start) =>
    portfolio.holdings.reduce(
      (sum, holding) =>
        sum + simulateRedemption(holding.factors, weights, holding.amount).at(-1)!.output,
      portfolio.collateral,
    );
  assert.equal(worth(start), 1_000n);
  assert.equal(worth(deeper), 1_000n);

  let merged = deeper;
  for (let guard = 0; guard < 10 && mergeOptions(merged).length > 0; guard += 1) {
    const option = mergeOptions(merged)[0]!;
    merged = mergePositions(
      merged,
      option.parent,
      option.condition,
      option.partition,
      option.amount,
    );
  }
  assert.equal(merged.holdings.length, 0);
  assert.equal(merged.collateral, 1_000n);
});

test("adding a question splits a claim without touching collateral", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.key === "governance")!;
  const [buyback, level] = scenario.conditions;
  const approved = [
    { conditionId: buyback!.conditionId, outcomeCount: 2, indexSet: indexSetFromOutcomes([0]) },
  ];
  const start = openLedger(50n, approved, 50n).portfolio;
  const ref = { conditionId: level!.conditionId, outcomeCount: 2 };
  const split = splitPosition(
    start,
    approved,
    ref,
    [indexSetFromOutcomes([0]), indexSetFromOutcomes([1])],
    50n,
  );
  assert.equal(split.collateral, 0n);
  assert.equal(split.holdings.length, 3);

  const options = mergeOptions(split);
  assert.ok(options.some((option) => option.result.length === 1));
});
