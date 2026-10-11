import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  deriveCollectionId,
  derivePositionId,
  fetchAllVerifiedScenarios,
  fetchVerifiedScenario,
  getClosePositionBalanceInstruction,
  ROOT_COLLECTION_ID,
  type ConditionClause,
} from "@cc-token/sdk";
import {
  AccountRole,
  address,
  createClient,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  sequentialInstructionPlan,
  summarizeTransactionPlanResult,
  type Instruction,
  type ReadonlyUint8Array,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";

import {
  createTestCollateral,
  prepareQuestion,
  publishScenario,
  redeem,
  reportPayouts,
  split,
  transfer,
  unwrap,
  wrap,
  type LiveClient,
} from "../src/live/chain.ts";
import { fetchCollateral, fetchPositions } from "../src/live/discovery.ts";
import { newQuestion, questionMemo, toCondition } from "../src/live/questions.ts";
import { indexSetFromOutcomes } from "../src/scenario.ts";

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
const UNIT = 1_000_000n;
const execute = process.env.CC_TOKEN_DEVNET_EXECUTE === "1";
const rpcUrl = requiredEnvironment("CC_TOKEN_RPC_URL");
const websocketUrl = requiredEnvironment("CC_TOKEN_WS_URL");
const runId = requiredEnvironment("CC_TOKEN_DEVNET_RUN_ID");
const payer = await readKeypair(requiredEnvironment("CC_TOKEN_DEVNET_PAYER"));
const client = liveClient(payer);
const preflightRpc = createSolanaRpc(rpcUrl);

test("submission target is the expected funded devnet deployment", async () => {
  assert.equal(await preflightRpc.getGenesisHash().send(), DEVNET_GENESIS_HASH);
  const program = await preflightRpc
    .getAccountInfo(CC_TOKEN_PROGRAM_ADDRESS, { encoding: "base64", commitment: "confirmed" })
    .send();
  assert.equal(program.value?.executable, true);

  const balance = await preflightRpc.getBalance(payer.address, { commitment: "confirmed" }).send();
  console.log(`Payer: ${payer.address}`);
  console.log(`Balance: ${Number(balance.value) / 1_000_000_000} SOL`);
  if (execute) {
    assert.ok(balance.value >= 250_000_000n, "fund the disposable payer with at least 0.25 SOL");
  }
});

test("deployed program completes the submission lifecycle", { skip: !execute }, async () => {
  const signatures: Signature[] = [];
  const remember = async (label: string, sent: Promise<readonly Signature[]>) => {
    const confirmed = await sent;
    signatures.push(...confirmed);
    console.log(`  ${label}: ${confirmed.length} confirmed transaction(s)`);
    return confirmed;
  };

  console.log("[1/8] Create and register test collateral");
  const created = await createTestCollateral(client, 100n * UNIT, 6, {
    name: "cc-token submission collateral",
    symbol: "CCTEST",
  });
  signatures.push(...created.signatures);
  console.log(`  collateral setup: ${created.signatures.length} confirmed transaction(s)`);
  console.log(`  collateral mint: ${created.mint}`);
  const collateral = await fetchCollateral(client.rpc, payer.address, created.mint);
  assert.equal(collateral.registered, true);
  assert.equal(collateral.free, 100n * UNIT);

  console.log("[2/8] Prepare two binary conditions");
  const weatherQuestion = newQuestion(
    payer.address,
    `Submission weather ${runId}`,
    ["dry", "wet"],
    runId,
  );
  const launchQuestion = newQuestion(
    payer.address,
    `Submission launch ${runId}`,
    ["on time", "late"],
    runId,
  );
  const weather = toCondition(weatherQuestion);
  const launch = toCondition(launchQuestion);
  await remember(
    "weather condition",
    prepareQuestion(client, weather.questionId, 2, questionMemo(weatherQuestion)),
  );
  await remember(
    "launch condition",
    prepareQuestion(client, launch.questionId, 2, questionMemo(launchQuestion)),
  );

  const weatherRef = { conditionId: weather.conditionId, outcomeCount: 2 };
  const launchRef = { conditionId: launch.conditionId, outcomeCount: 2 };
  const on = (condition: typeof weatherRef, outcome: number): ConditionClause => ({
    ...condition,
    indexSet: indexSetFromOutcomes([outcome]),
  });
  const dry = on(weatherRef, 0);
  const wet = on(weatherRef, 1);
  const onTime = on(launchRef, 0);
  const late = on(launchRef, 1);

  console.log("[3/8] Publish and discover the scenario anchor");
  const published = await publishScenario(
    client,
    created.mint,
    `cc-token submission test ${runId}`,
    [dry, onTime],
    "logical",
  );
  signatures.push(...published.signatures);
  console.log(`  scenario publication: ${published.signatures.length} confirmed transaction(s)`);
  const scenario = await fetchVerifiedScenario(client.rpc, published.address, {
    commitment: "confirmed",
  });
  assert.equal(scenario.definition.data.creator, payer.address);
  assert.equal(scenario.factorCount, 2);
  const discovery = await fetchAllVerifiedScenarios(client.rpc, { commitment: "confirmed" });
  assert.ok(discovery.scenarios.some((entry) => entry.definition.address === published.address));
  console.log(`  scenario discovered: ${published.address}`);

  console.log("[4/8] Deposit collateral and refine the dry claim");
  await remember(
    "root collateral split",
    split(client, collateral, [], weatherRef, [dry.indexSet, wet.indexSet], 10n * UNIT),
  );
  await remember(
    "nested position split",
    split(client, collateral, [dry], launchRef, [onTime.indexSet, late.indexSet], 10n * UNIT),
  );

  console.log("[5/8] Wrap and unwrap one position share");
  await remember("wrap", wrap(client, collateral, [wet], UNIT));
  await remember("unwrap", unwrap(client, collateral, [wet], UNIT));

  console.log("[6/8] Transfer one native share to a new wallet and back");
  const recipient = await generateKeyPairSigner();
  await remember("fund recipient rent", fundRecipient(client, recipient.address, 5_000_000n));
  await remember(
    "outbound position transfer",
    transfer(client, collateral, [wet], recipient.address, UNIT),
  );
  const recipientClient = liveClient(recipient);
  await remember(
    "return position transfer",
    transfer(recipientClient, collateral, [wet], payer.address, UNIT),
  );

  console.log("[7/8] Resolve both conditions");
  await remember("weather payouts", reportPayouts(client, weather.conditionId, [1n, 0n]));
  await remember("launch payouts", reportPayouts(client, launch.conditionId, [1n, 0n]));

  console.log("[8/8] Redeem all claims and close zero balances");
  await remember("winning nested claim", redeem(client, collateral, [dry, onTime], 1, 10n * UNIT));
  await remember("losing nested claim", redeem(client, collateral, [dry, late], 1, 10n * UNIT));
  await remember("residual dry claim", redeem(client, collateral, [dry], 0, 10n * UNIT));
  await remember("wet claim", redeem(client, collateral, [wet], 0, 10n * UNIT));

  assert.equal((await fetchCollateral(client.rpc, payer.address, created.mint)).free, 100n * UNIT);
  await remember("payer balance cleanup", closeZeroBalances(client, created.mint));
  await remember("recipient balance cleanup", closeZeroBalances(recipientClient, created.mint));
  console.log("  collateral restored: 100 tokens");

  const receiptDirectory = resolve("target/devnet-tests");
  mkdirSync(receiptDirectory, { recursive: true });
  const receipt = resolve(receiptDirectory, `${runId}.json`);
  writeFileSync(
    receipt,
    `${JSON.stringify(
      {
        cluster: "devnet",
        genesisHash: DEVNET_GENESIS_HASH,
        programId: CC_TOKEN_PROGRAM_ADDRESS,
        payer: payer.address,
        collateralMint: created.mint,
        scenario: published.address,
        signatures,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Scenario retained for discovery: ${published.address}`);
  console.log(`Confirmed transactions: ${signatures.length}`);
  console.log(`Receipt: ${relative(process.cwd(), receipt)}`);
});

function liveClient(signer: TransactionSigner): LiveClient {
  return createClient()
    .use((base) => ({ ...base, payer: signer }))
    .use(
      solanaRpc({
        rpcUrl,
        rpcSubscriptionsUrl: websocketUrl,
        transactionConfig: { version: 0 },
      }),
    );
}

async function send(client: LiveClient, instructions: readonly Instruction[]) {
  const result = await client.sendTransactions(sequentialInstructionPlan([...instructions]));
  return summarizeTransactionPlanResult(result).successfulTransactions.map(
    (transaction) => transaction.context.signature,
  );
}

async function fundRecipient(client: LiveClient, recipient: string, amount: bigint) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);
  return send(client, [
    {
      programAddress: SYSTEM_PROGRAM_ADDRESS,
      accounts: [
        {
          address: client.payer.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer: client.payer,
        },
        { address: address(recipient), role: AccountRole.WRITABLE },
      ],
      data,
    } as Instruction,
  ]);
}

async function closeZeroBalances(client: LiveClient, collateralMint: string) {
  const found = await fetchPositions(client.rpc, client.payer.address, address(collateralMint));
  const instructions: Instruction[] = [];
  for (const position of found.positions) {
    if (position.amount !== 0n) continue;
    let collectionId: ReadonlyUint8Array = ROOT_COLLECTION_ID;
    for (const factor of position.factors) {
      collectionId = deriveCollectionId(
        collectionId,
        factor.conditionId,
        factor.indexSet,
      ).collectionId;
    }
    instructions.push(
      await getClosePositionBalanceInstruction({
        owner: client.payer,
        positionId: derivePositionId(address(collateralMint), collectionId),
      }),
    );
  }
  return instructions.length === 0 ? [] : send(client, instructions);
}

async function readKeypair(path: string) {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error("payer must be a 64-byte Solana keypair JSON file");
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(value));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
