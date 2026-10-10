import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveConditionId, type ConditionClause } from "@cc-token/sdk";
import { getAddressDecoder } from "@solana/kit";

import { COLLATERAL_KEY, layoutGraph } from "../src/ledger.ts";
import { getNameTokenInstruction, inBatches, TEST_TOKEN_NAME } from "../src/live/chain.ts";
import { decodeTokenLabel, ledgerFromPositions } from "../src/live/discovery.ts";
import {
  loadQuestions,
  newQuestion,
  questionFromMemo,
  questionMemo,
  saveQuestions,
  toCondition,
  unnamedCondition,
} from "../src/live/questions.ts";
import { holdingKey, indexSetFromOutcomes, toHex } from "../src/scenario.ts";

const resolver = getAddressDecoder().decode(new Uint8Array(32).fill(5));
const weather = toCondition(newQuestion(resolver, "Weather", ["sun", "rain", "snow"], "salt"));
const launch = toCondition(newQuestion(resolver, "Launch", ["on time", "late"], "salt"));

function on(condition: typeof weather, outcomes: readonly number[]): ConditionClause {
  return {
    conditionId: condition.conditionId,
    outcomeCount: condition.outcomes.length,
    indexSet: indexSetFromOutcomes(outcomes),
  };
}

test("a stored question derives the condition the program will hold", () => {
  const question = newQuestion(resolver, "Weather", ["sun", "rain", "snow"], "salt");
  assert.deepEqual(
    weather.conditionId,
    deriveConditionId(resolver, weather.questionId, weather.outcomes.length),
  );
  assert.equal(weather.key, toHex(weather.conditionId));
  assert.equal(toHex(weather.questionId), question.questionId);
  // The same wording asked again is a new question.
  assert.notEqual(
    newQuestion(resolver, "Weather", ["sun", "rain", "snow"], "other").questionId,
    question.questionId,
  );
});

test("questions survive storage and bad stored data is ignored", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const question = newQuestion(resolver, "Launch", ["on time", "late"], "salt");
  saveQuestions(storage, "questions", [question]);
  assert.deepEqual(loadQuestions(storage, "questions"), [question]);
  assert.deepEqual(toCondition(loadQuestions(storage, "questions")[0]!), launch);

  values.set("questions", "not json");
  assert.deepEqual(loadQuestions(storage, "questions"), []);
  assert.deepEqual(loadQuestions(storage, "missing"), []);
});

const onChain = {
  conditionId: weather.conditionId,
  questionId: weather.questionId,
  resolver,
  outcomeCount: 3,
  payouts: null,
};

test("a question's wording is recovered from its memo only when it matches the ID", () => {
  const question = newQuestion(resolver, "Weather", ["sun", "rain", "snow"], "salt");
  const memo = questionMemo(question)!;
  // The RPC reports a memo with its length in front.
  assert.deepEqual(questionFromMemo(`[${memo.length}] ${memo}`, onChain), question);
  assert.deepEqual(toCondition(questionFromMemo(memo, onChain)!), weather);

  // Other wording, or the right wording for another question, is refused.
  const forged = questionMemo(newQuestion(resolver, "Weather", ["win", "lose", "draw"], "salt"))!;
  assert.equal(questionFromMemo(forged, onChain), null);
  assert.equal(questionFromMemo(memo, { ...onChain, questionId: launch.questionId }), null);
  assert.equal(questionFromMemo("unrelated memo", onChain), null);

  // Wording too long for one transaction is not published.
  const long = newQuestion(resolver, "x".repeat(700), ["a", "b"], "salt");
  assert.equal(questionMemo(long), null);
  const { document: _, ...legacy } = question;
  assert.equal(questionMemo(legacy), null);
});

test("an unknown on-chain question gets placeholder names", () => {
  const condition = unnamedCondition({
    ...onChain,
  });
  assert.equal(condition.key, weather.key);
  assert.deepEqual(condition.outcomes, ["result 1", "result 2", "result 3"]);
});

test("balances are drawn under the position they can be cut from", () => {
  const dry = on(weather, [0, 1]);
  const sun = on(weather, [0]);
  const snow = on(weather, [2]);
  const late = on(launch, [1]);
  const ledger = ledgerFromPositions(900n, [
    { factors: [sun], amount: 40n },
    { factors: [dry], amount: 60n },
    // Emptied by a split, but still the parent of what follows.
    { factors: [snow], amount: 0n },
    { factors: [snow, late], amount: 100n },
    // Emptied and with nothing under it.
    { factors: [late], amount: 0n },
  ]);

  const sourceOf = (factors: readonly ConditionClause[]) =>
    ledger.edges.find((edge) => edge.to === holdingKey(factors))?.from;
  assert.equal(sourceOf([dry]), COLLATERAL_KEY);
  assert.equal(sourceOf([sun]), holdingKey([dry]));
  assert.equal(sourceOf([snow]), COLLATERAL_KEY);
  assert.equal(sourceOf([snow, late]), holdingKey([snow]));

  assert.equal(ledger.portfolio.collateral, 900n);
  assert.deepEqual(
    ledger.portfolio.holdings.map((holding) => holding.amount),
    [40n, 60n, 100n],
  );
  assert.equal(ledger.nodes.length, 4);
  assert.ok(!ledger.nodes.some((node) => node.key === holdingKey([late])));
  assert.equal(layoutGraph(ledger).slots.size, 5);
});

test("a position held only as wrapped tokens stays on the graph", () => {
  const snow = on(weather, [2]);
  const ledger = ledgerFromPositions(0n, [
    { factors: [snow], amount: 0n, wrapped: 5n },
    { factors: [on(weather, [0, 1])], amount: 0n, wrapped: 0n },
  ]);
  assert.deepEqual(
    ledger.nodes.map((node) => node.key),
    [holdingKey([snow])],
  );
  // Only native shares can be split, merged or redeemed.
  assert.equal(ledger.portfolio.holdings.length, 0);
});

test("the narrowest containing position is the source", () => {
  const all = on(weather, [0, 1]);
  const ledger = ledgerFromPositions(0n, [
    { factors: [on(launch, [0]), all], amount: 1n },
    { factors: [on(launch, [0]), on(weather, [0])], amount: 1n },
    // Reached in the other factor order: still the same parent.
    { factors: [on(weather, [1]), on(launch, [0])], amount: 1n },
  ]);
  const parent = holdingKey([on(launch, [0]), all]);
  assert.deepEqual(
    ledger.edges.map((edge) => edge.from),
    [COLLATERAL_KEY, parent, parent],
  );
});

test("long account lists are read at most 100 at a time, in order", async () => {
  const addresses = Array.from({ length: 250 }, (_, index) => index);
  const requests: number[] = [];
  const accounts = await inBatches(addresses, async (batch) => {
    requests.push(batch.length);
    return batch.map((address) => address * 2);
  });
  assert.deepEqual(requests, [100, 100, 50]);
  assert.deepEqual(
    accounts,
    addresses.map((address) => address * 2),
  );
  assert.deepEqual(await inBatches([], async () => assert.fail("nothing to read")), []);
});

test("a token's name is read from its metadata account and tied to its mint", () => {
  const mint = getAddressDecoder().decode(new Uint8Array(32).fill(3));
  const padded = (text: string, size: number) => {
    const bytes = new Uint8Array(4 + size);
    new DataView(bytes.buffer).setUint32(0, size, true);
    bytes.set(new TextEncoder().encode(text), 4);
    return bytes;
  };
  // As the metadata program stores it: key, update authority, mint, then padded strings.
  const account = Uint8Array.from([
    4,
    ...new Uint8Array(32).fill(1),
    ...new Uint8Array(32).fill(3),
    ...padded("cc-token test collateral", 32),
    ...padded("TEST", 10),
    ...padded("", 200),
  ]);
  assert.deepEqual(decodeTokenLabel(account, mint), TEST_TOKEN_NAME);
  assert.equal(decodeTokenLabel(account, resolver), null);
  assert.equal(decodeTokenLabel(account.slice(0, 70), mint), null);
  assert.equal(decodeTokenLabel(Uint8Array.from([6, ...account.slice(1)]), mint), null);
});

test("the naming instruction carries the name, symbol and an empty link", async () => {
  const mint = getAddressDecoder().decode(new Uint8Array(32).fill(3));
  const authority = { address: resolver } as Parameters<typeof getNameTokenInstruction>[0];
  const instruction = await getNameTokenInstruction(authority, mint);
  const data = Uint8Array.from(instruction.data!);
  assert.equal(data[0], 33);
  assert.equal(new TextDecoder().decode(data.slice(5, 29)), "cc-token test collateral");
  assert.equal(new TextDecoder().decode(data.slice(33, 37)), "TEST");
  assert.deepEqual([...data.slice(37)], [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert.equal(instruction.accounts?.length, 6);
  assert.equal(instruction.accounts?.[1]?.address, mint);
});
