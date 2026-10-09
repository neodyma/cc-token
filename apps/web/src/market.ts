import type { ConditionClause } from "@cc-token/sdk";

import { outcomesInIndexSet, toHex, type DemoCondition } from "./scenario.ts";

// A simulated venue, not part of the protocol: one automated market maker (logarithmic market
// scoring rule) over every combination of results, so it can quote any claim. It assumes each
// question ends with a single winning result. Amounts are whole tokens as floating point.
export type Market = Readonly<{
  liquidity: number;
  // One entry per combination of results: the winning outcome of each question, in order.
  atoms: readonly (readonly number[])[];
  sold: readonly number[];
}>;

// Token amounts reach the market as floating point, which is exact only up to 2^53 base units.
export function toMarketAmount(amount: bigint, decimals: number): number {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("that amount is too large for the simulated market");
  }
  return Number(amount) / 10 ** decimals;
}

export function openMarket(
  conditions: readonly DemoCondition[],
  odds: Readonly<Record<string, readonly number[]>>,
  liquidity: number,
): Market {
  let atoms: number[][] = [[]];
  let weights: number[] = [1];
  for (const condition of conditions) {
    const conditionOdds = odds[condition.key];
    if (!conditionOdds || conditionOdds.length !== condition.outcomes.length) {
      throw new RangeError(`odds for ${condition.key} must list every result`);
    }
    const nextAtoms: number[][] = [];
    const nextWeights: number[] = [];
    atoms.forEach((atom, index) => {
      conditionOdds.forEach((odd, outcome) => {
        nextAtoms.push([...atom, outcome]);
        nextWeights.push(weights[index]! * odd);
      });
    });
    atoms = nextAtoms;
    weights = nextWeights;
  }
  // Starting quantities that make the opening prices equal the given odds.
  return { liquidity, atoms, sold: weights.map((weight) => liquidity * Math.log(weight)) };
}

// Adds a question with even odds. Existing prices are unchanged.
export function extendMarket(market: Market, outcomeCount: number): Market {
  const shift = market.liquidity * Math.log(1 / outcomeCount);
  const outcomes = Array.from({ length: outcomeCount }, (_, outcome) => outcome);
  return {
    ...market,
    atoms: market.atoms.flatMap((atom) => outcomes.map((outcome) => [...atom, outcome])),
    sold: market.sold.flatMap((quantity) => outcomes.map(() => quantity + shift)),
  };
}

// Which combinations of results a claim pays on.
export function claimAtoms(
  market: Market,
  conditions: readonly DemoCondition[],
  factors: readonly ConditionClause[],
): readonly boolean[] {
  const allowed = factors.map((factor) => {
    const id = toHex(factor.conditionId);
    const index = conditions.findIndex((condition) => toHex(condition.conditionId) === id);
    if (index === -1) throw new Error("unknown condition");
    return { index, outcomes: outcomesInIndexSet(factor.indexSet, factor.outcomeCount) };
  });
  return market.atoms.map((atom) =>
    allowed.every(({ index, outcomes }) => outcomes.includes(atom[index]!)),
  );
}

function cost(liquidity: number, sold: readonly number[]): number {
  const peak = Math.max(...sold);
  const sum = sold.reduce((total, quantity) => total + Math.exp((quantity - peak) / liquidity), 0);
  return peak + liquidity * Math.log(sum);
}

function atomPrices(market: Market): number[] {
  const peak = Math.max(...market.sold);
  const weights = market.sold.map((quantity) => Math.exp((quantity - peak) / market.liquidity));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

// The price of one share. Because this market assumes one winner per question, it is also the
// market's probability that the claim pays.
export function price(market: Market, members: readonly boolean[]): number {
  return atomPrices(market).reduce((sum, value, index) => sum + (members[index] ? value : 0), 0);
}

export function outcomePrices(market: Market, conditionIndex: number): number[] {
  const prices: number[] = [];
  atomPrices(market).forEach((value, index) => {
    const outcome = market.atoms[index]![conditionIndex]!;
    prices[outcome] = (prices[outcome] ?? 0) + value;
  });
  return prices;
}

export function buy(market: Market, members: readonly boolean[], shares: number): Market {
  return {
    ...market,
    sold: market.sold.map((quantity, index) => quantity + (members[index] ? shares : 0)),
  };
}

// What buying `shares` costs; negative shares is a sale and gives a negative cost.
export function quote(market: Market, members: readonly boolean[], shares: number): number {
  return (
    cost(market.liquidity, buy(market, members, shares).sold) - cost(market.liquidity, market.sold)
  );
}
