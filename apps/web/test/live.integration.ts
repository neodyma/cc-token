import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyScenarioParticipation,
  fetchAllVerifiedScenarios,
  fetchVerifiedScenario,
  TOKEN_2022_PROGRAM_ADDRESS,
  type ConditionClause,
} from "@cc-token/sdk";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { createClient, generateKeyPairSigner, lamports, type Address } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";

import { COLLATERAL_KEY } from "../src/ledger.ts";
import {
  clearTakePositionCheckpoints,
  createTestCollateral,
  merge,
  mintTestCollateral,
  prepareQuestion,
  publishScenario,
  redeem,
  reportPayouts,
  renameScenario,
  split,
  takePosition,
  transfer,
  unwrap,
  wrap,
} from "../src/live/chain.ts";
import {
  fetchCollateral,
  fetchConditions,
  fetchHeldCollaterals,
  fetchPositions,
  ledgerFromPositions,
  positionsForScenario,
  recoverQuestion,
  whenCaughtUp,
} from "../src/live/discovery.ts";
import { newQuestion, questionMemo, toCondition } from "../src/live/questions.ts";
import { holdingKey, indexSetFromOutcomes, toHex } from "../src/scenario.ts";

const rpcUrl = process.env.CC_TOKEN_RPC_URL;
const rpcSubscriptionsUrl = process.env.CC_TOKEN_WS_URL;
if (!rpcUrl || !rpcSubscriptionsUrl) throw new Error("local validator URLs are required");

// The same client shape the browser builds, with a disposable keypair in place of the wallet.
async function fundedClient() {
  const payer = await generateKeyPairSigner();
  const client = createClient()
    .use((base) => ({ ...base, payer }))
    .use(solanaRpc({ rpcUrl: rpcUrl!, rpcSubscriptionsUrl: rpcSubscriptionsUrl! }));
  await client.rpc
    .requestAirdrop(payer.address, lamports(2_000_000_000n), { commitment: "confirmed" })
    .send();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await client.rpc.getBalance(payer.address).send()).value > 0n) return client;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("airdrop was not observed");
}

const UNIT = 1_000_000n;

test("the live page's transactions run the whole lifecycle", async () => {
  const client = await fundedClient();
  const owner = client.payer.address;

  const created = await createTestCollateral(client, 1_000n * UNIT, 6);
  assert.equal(created.signatures.length, 1);
  const collateral = await fetchCollateral(client.rpc, owner, created.mint);
  assert.equal(collateral.registered, true);
  assert.equal(collateral.mintable, true);
  assert.equal(collateral.issuerControlled, false);
  assert.equal(collateral.decimals, 6);
  assert.equal(collateral.free, 1_000n * UNIT);
  // The local validator has no metadata program, so the token is created without a name.
  assert.equal(collateral.label, null);

  const weatherQuestion = newQuestion(owner, "Weather", ["sun", "rain", "snow"], "a");
  const weather = toCondition(weatherQuestion);
  const launch = toCondition(newQuestion(owner, "Launch", ["on time", "late"], "a"));
  const venue = toCondition(newQuestion(owner, "Venue", ["Berlin", "Paris"], "a"));
  await prepareQuestion(client, weather.questionId, 3, questionMemo(weatherQuestion));
  await prepareQuestion(client, launch.questionId, 2);
  await prepareQuestion(client, venue.questionId, 2);
  const prepared = await fetchConditions(client.rpc, [
    weather.conditionId,
    launch.conditionId,
    venue.conditionId,
  ]);
  assert.equal(prepared.get(weather.key)?.outcomeCount, 3);
  assert.equal(prepared.get(launch.key)?.resolver, owner);
  assert.equal(prepared.get(launch.key)?.payouts, null);

  // The wording published with a question can be read back by anyone; without it, nothing.
  assert.deepEqual(await recoverQuestion(client.rpc, prepared.get(weather.key)!), weatherQuestion);
  assert.equal(await recoverQuestion(client.rpc, prepared.get(launch.key)!), null);
  assert.deepEqual(await fetchHeldCollaterals(client.rpc, owner), {
    collaterals: [],
    wrappedChecked: true,
  });

  const weatherRef = { conditionId: weather.conditionId, outcomeCount: 3 };
  const launchRef = { conditionId: launch.conditionId, outcomeCount: 2 };
  const venueRef = { conditionId: venue.conditionId, outcomeCount: 2 };
  const on = (ref: typeof weatherRef, outcomes: readonly number[]): ConditionClause => ({
    ...ref,
    indexSet: indexSetFromOutcomes(outcomes),
  });
  const dry = on(weatherRef, [0, 1]);
  const snow = on(weatherRef, [2]);
  const sun = on(weatherRef, [0]);
  const rain = on(weatherRef, [1]);
  const onTime = on(launchRef, [0]);
  const late = on(launchRef, [1]);
  const berlin = on(venueRef, [0]);

  // Scenario publication registers a zero-balance anchor and becomes globally discoverable.
  const published = await publishScenario(
    client,
    created.mint,
    "Weather and launch",
    [dry, onTime],
    "logical",
  );
  assert.ok(published.signatures.length >= 1);
  const scenario = await fetchVerifiedScenario(client.rpc, published.address);
  assert.equal(scenario.definition.data.name, "Weather and launch");
  assert.equal(scenario.factorCount, 2);
  assert.equal(scenario.state, "active");
  const discovery = await fetchAllVerifiedScenarios(client.rpc);
  assert.ok(
    discovery.scenarios.some((candidate) => candidate.definition.address === published.address),
  );
  assert.equal(discovery.failures.length, 0);
  await renameScenario(client, scenario.definition.data.anchorPositionId, "Weather and launch v2");
  const renamed = await fetchVerifiedScenario(client.rpc, published.address);
  assert.equal(renamed.definition.data.name, "Weather and launch v2");
  const secondPublished = await publishScenario(
    client,
    created.mint,
    "Weather and venue",
    [dry, berlin],
    "logical",
  );
  const secondScenario = await fetchVerifiedScenario(client.rpc, secondPublished.address);

  async function balances(mint: Address = created.mint) {
    const { positions } = await fetchPositions(client.rpc, owner, mint);
    return new Map(positions.map((position) => [holdingKey(position.factors), position.amount]));
  }
  const held = async (factors: readonly ConditionClause[]) =>
    (await balances()).get(holdingKey(factors)) ?? 0n;
  const free = async () => (await fetchCollateral(client.rpc, owner, created.mint)).free;

  // Deposit: collateral into a full set on one question.
  await split(client, collateral, [], weatherRef, [dry.indexSet, snow.indexSet], 100n * UNIT);
  assert.equal(await free(), 900n * UNIT);
  assert.equal(await held([dry]), 100n * UNIT);
  assert.equal(await held([snow]), 100n * UNIT);
  const dryPosition = (await fetchPositions(client.rpc, owner, created.mint)).positions.find(
    (position) => holdingKey(position.factors) === holdingKey([dry]),
  )!;
  assert.equal(
    classifyScenarioParticipation(scenario, {
      collateralMint: created.mint,
      factors: dryPosition.factors,
    }),
    "compatible",
  );
  assert.equal(
    classifyScenarioParticipation(secondScenario, {
      collateralMint: created.mint,
      factors: dryPosition.factors,
    }),
    "compatible",
  );

  // A read that names a slot is refused until the node has reached it, and retried.
  const ahead = { minContextSlot: (await client.rpc.getSlot().send()) + 1_000_000n };
  await assert.rejects(fetchPositions(client.rpc, owner, created.mint, ahead));
  await assert.rejects(fetchCollateral(client.rpc, owner, created.mint, ahead));
  let reads = 0;
  const caughtUp = await whenCaughtUp(() => {
    reads += 1;
    return fetchPositions(client.rpc, owner, created.mint, reads === 1 ? ahead : {});
  });
  assert.equal(reads, 2);
  assert.equal(caughtUp.positions.length, 2);

  // Narrow one piece, then combine the other with a second question.
  await split(client, collateral, [], weatherRef, [sun.indexSet, rain.indexSet], 40n * UNIT);
  await split(client, collateral, [snow], launchRef, [onTime.indexSet, late.indexSet], 100n * UNIT);
  assert.equal(await held([dry]), 60n * UNIT);
  assert.equal(await held([sun]), 40n * UNIT);
  assert.equal(await held([snow]), 0n);
  assert.equal(await held([snow, onTime]), 100n * UNIT);
  assert.equal(await held([late, snow]), 100n * UNIT);
  assert.equal(
    classifyScenarioParticipation(scenario, {
      collateralMint: created.mint,
      factors: [snow, onTime],
    }),
    "exact",
  );

  const { positions } = await fetchPositions(client.rpc, owner, created.mint);
  assert.ok(
    positionsForScenario([dry, onTime], positions).some(
      (position) => holdingKey(position.factors) === holdingKey([dry]),
    ),
  );
  assert.ok(
    positionsForScenario([dry, berlin], positions).some(
      (position) => holdingKey(position.factors) === holdingKey([dry]),
    ),
  );
  assert.ok(
    positionsForScenario([dry, berlin], positions).every((position) =>
      position.factors.every(
        (factor) =>
          weather.key === toHex(factor.conditionId) || venue.key === toHex(factor.conditionId),
      ),
    ),
  );
  const ledger = ledgerFromPositions(await free(), positions);
  const sourceOf = (factors: readonly ConditionClause[]) =>
    ledger.edges.find((edge) => edge.to === holdingKey(factors))?.from;
  assert.equal(sourceOf([dry]), COLLATERAL_KEY);
  assert.equal(sourceOf([sun]), holdingKey([dry]));
  assert.equal(sourceOf([snow, onTime]), holdingKey([snow]));
  assert.equal(ledger.portfolio.holdings.length, 5);

  // Another collateral's positions are not mixed in.
  const other = await createTestCollateral(client, UNIT, 0);
  assert.equal((await balances(other.mint)).size, 0);

  // Merge back each way: narrowed pieces, a combination, and a full set into collateral.
  await merge(client, collateral, [], weatherRef, [sun.indexSet, rain.indexSet], 40n * UNIT);
  await merge(client, collateral, [snow], launchRef, [onTime.indexSet, late.indexSet], 30n * UNIT);
  await merge(client, collateral, [], weatherRef, [dry.indexSet, snow.indexSet], 30n * UNIT);
  assert.equal(await held([dry]), 70n * UNIT);
  assert.equal(await held([snow]), 0n);
  assert.equal(await free(), 930n * UNIT);

  // Three pieces that cover every result go in and out of collateral in one transaction.
  const thirds = [sun.indexSet, rain.indexSet, snow.indexSet];
  await split(client, collateral, [], weatherRef, thirds, 10n * UNIT);
  assert.equal(await free(), 920n * UNIT);
  const whole = await merge(client, collateral, [], weatherRef, thirds, 10n * UNIT);
  assert.equal(whole.length, 1);
  assert.equal(await free(), 930n * UNIT);
  assert.equal(await held([sun]), 0n);

  // Wrap part of a position as a Token-2022 token and take some of it back.
  await wrap(client, collateral, [dry], 20n * UNIT);
  const wrappedDry = async (holder: Address = owner) =>
    (await fetchPositions(client.rpc, holder, created.mint)).positions.find(
      (position) => holdingKey(position.factors) === holdingKey([dry]),
    );
  assert.equal((await wrappedDry())?.amount, 50n * UNIT);
  assert.equal((await wrappedDry())?.wrapped, 20n * UNIT);
  await wrap(client, collateral, [dry], UNIT);
  await unwrap(client, collateral, [dry], 6n * UNIT);
  assert.equal((await wrappedDry())?.amount, 55n * UNIT);
  assert.equal((await wrappedDry())?.wrapped, 15n * UNIT);

  // When the wallet cannot be searched for wrapper tokens, the balances are still found.
  const withoutTokenScan = new Proxy(client.rpc, {
    get: (rpc, method, receiver) =>
      method === "getTokenAccountsByOwner"
        ? () => ({ send: () => Promise.reject(new Error("too many requests")) })
        : Reflect.get(rpc, method, receiver),
  });
  const unscanned = await fetchPositions(withoutTokenScan, owner, created.mint);
  assert.equal(unscanned.wrappedChecked, false);
  const unscannedDry = unscanned.positions.find(
    (position) => holdingKey(position.factors) === holdingKey([dry]),
  );
  assert.equal(unscannedDry?.amount, 55n * UNIT);
  assert.equal(unscannedDry?.wrapped, 0n);
  assert.equal((await fetchHeldCollaterals(withoutTokenScan, owner)).wrappedChecked, false);
  assert.equal((await fetchPositions(client.rpc, owner, created.mint)).wrappedChecked, true);

  // The token moves like any other. Someone who only ever received it sees the position and
  // can unwrap it without having held a native balance.
  const stranger = await fundedClient();
  // A creator can paste any registered mint; holding its token or a prior position is unnecessary.
  const pastedCollateral = await fetchCollateral(stranger.rpc, stranger.payer.address, other.mint);
  assert.equal(pastedCollateral.registered, true);
  assert.equal(pastedCollateral.free, 0n);
  const pastedScenario = await publishScenario(
    stranger,
    other.mint,
    "Scenario on pasted collateral",
    [dry],
    "logical",
  );
  assert.equal(
    (await fetchVerifiedScenario(stranger.rpc, pastedScenario.address)).definition.data.creator,
    stranger.payer.address,
  );
  const wrapperMint = (await wrappedDry())!.wrapperMint!;
  const tokenAccount = async (holder: Address) =>
    (
      await findAssociatedTokenPda({
        owner: holder,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        mint: wrapperMint,
      })
    )[0];
  await client.sendTransactions([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: await tokenAccount(stranger.payer.address),
      owner: stranger.payer.address,
      mint: wrapperMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getTransferCheckedInstruction(
      {
        source: await tokenAccount(owner),
        mint: wrapperMint,
        destination: await tokenAccount(stranger.payer.address),
        authority: client.payer,
        amount: 5n * UNIT,
        decimals: 6,
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
    ),
  ]);
  assert.equal((await wrappedDry(stranger.payer.address))?.amount, 0n);
  assert.equal((await wrappedDry(stranger.payer.address))?.wrapped, 5n * UNIT);
  const received = await fetchPositions(client.rpc, stranger.payer.address, created.mint);
  assert.equal(ledgerFromPositions(0n, received.positions).nodes.length, 1);
  // Starting from nothing but the wallet address: which collateral, then which question.
  assert.deepEqual(await fetchHeldCollaterals(client.rpc, stranger.payer.address), {
    collaterals: [{ mint: created.mint, positions: 1, label: null }],
    wrappedChecked: true,
  });
  const [receivedCondition] = [...received.conditions.values()];
  assert.equal(
    (await recoverQuestion(stranger.rpc, receivedCondition!))?.title,
    weatherQuestion.title,
  );
  assert.deepEqual(await fetchHeldCollaterals(client.rpc, owner), {
    collaterals: [{ mint: created.mint, positions: 3, label: null }],
    wrappedChecked: true,
  });
  await unwrap(stranger, collateral, [dry], 5n * UNIT);
  assert.equal((await wrappedDry(stranger.payer.address))?.amount, 5n * UNIT);
  assert.equal((await wrappedDry(stranger.payer.address))?.wrapped, 0n);
  await unwrap(client, collateral, [dry], 10n * UNIT);
  assert.equal((await wrappedDry())?.amount, 65n * UNIT);

  // Native shares go straight to any address, which needs no account or SOL beforehand.
  const friend = (await generateKeyPairSigner()).address;
  await transfer(client, collateral, [dry], friend, 3n * UNIT);
  await transfer(client, collateral, [dry], friend, 2n * UNIT);
  assert.equal((await wrappedDry(friend))?.amount, 5n * UNIT);
  assert.equal((await wrappedDry())?.amount, 60n * UNIT);
  assert.deepEqual(await fetchHeldCollaterals(client.rpc, friend), {
    collaterals: [{ mint: created.mint, positions: 1, label: null }],
    wrappedChecked: true,
  });
  await assert.rejects(transfer(client, collateral, [dry], owner, UNIT));
  await assert.rejects(transfer(client, collateral, [dry], friend, 61n * UNIT));

  // Only the resolver can report.
  await assert.rejects(reportPayouts(stranger, weather.conditionId, [0n, 0n, 1n]));
  await reportPayouts(client, weather.conditionId, [0n, 0n, 1n]);
  await reportPayouts(client, launch.conditionId, [1n, 3n]);
  const resolved = await fetchConditions(client.rpc, [weather.conditionId, launch.conditionId]);
  assert.deepEqual(resolved.get(weather.key)?.payouts, [0n, 0n, 1n]);
  assert.deepEqual(resolved.get(launch.key)?.payouts, [1n, 3n]);

  // Redeem one question at a time. Redeeming the weather first leaves a position on the
  // launch alone, whose collection nobody registered before.
  await redeem(client, collateral, [snow, onTime], 1, 70n * UNIT);
  assert.equal(await held([snow]), (70n * UNIT) / 4n);
  await redeem(client, collateral, [snow, late], 0, 70n * UNIT);
  assert.equal(await held([late]), 70n * UNIT);
  await redeem(client, collateral, [late], 0, 70n * UNIT);
  await redeem(client, collateral, [snow], 0, (70n * UNIT) / 4n);
  await redeem(client, collateral, [dry], 0, 60n * UNIT);
  assert.equal(await free(), 1_000n * UNIT);
  assert.ok([...(await balances()).values()].every((amount) => amount === 0n));

  await mintTestCollateral(client, collateral, 5n * UNIT);
  assert.equal(await free(), 1_005n * UNIT);

  // A scenario acquisition resumes after its first confirmed split without depositing twice.
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  const takeOptions = {
    operationId: "interrupted-acquisition",
    storage,
    checkpointPrefix: "test:take:",
  };
  await assert.rejects(
    takePosition(client, collateral, [sun, onTime], 5n * UNIT, {
      ...takeOptions,
      onStep(completed) {
        if (completed === 1) throw new Error("browser closed");
      },
    }),
    /browser closed/,
  );
  assert.equal(await free(), 1_000n * UNIT);
  assert.equal(await held([sun]), 5n * UNIT);
  assert.equal(await held([sun, onTime]), 0n);
  const taken = await takePosition(client, collateral, [sun, onTime], 5n * UNIT, takeOptions);
  assert.ok(taken.length >= 2);
  assert.equal(await free(), 1_000n * UNIT);
  assert.equal(await held([sun, onTime]), 5n * UNIT);
  assert.equal(await held([sun, late]), 5n * UNIT);
  assert.equal(await held([sun]), 0n);
  await clearTakePositionCheckpoints(owner, created.mint, [sun, onTime], 5n * UNIT, takeOptions);
  assert.equal(stored.size, 0);
});
