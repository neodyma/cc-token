import assert from "node:assert/strict";
import { test } from "node:test";

import { address, generateKeyPairSigner, lamports, type Account, type Address } from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  classifyScenarioParticipation,
  derivePositionId,
  getScenarioAddress,
  MAX_SCENARIO_NAME_BYTES,
  planScenarioAnchor,
  SCENARIO_DEFINITION_SPACE,
  validateScenarioName,
  verifyScenarioDefinitionAccount,
  type ConditionClause,
  type ScenarioDefinition,
  type VerifiedScenario,
} from "../src/index.ts";
import { getScenarioDefinitionDiscriminatorBytes } from "../src/generated/index.ts";

const creator = address("11111111111111111111111111111111");
const collateralMint = address("So11111111111111111111111111111111111111112");

function conditionId(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function factor(value: number): ConditionClause {
  return { conditionId: conditionId(value), outcomeCount: 2, indexSet: [1n, 0n, 0n, 0n] };
}

test("validates scenario names by UTF-8 bytes", () => {
  assert.equal(MAX_SCENARIO_NAME_BYTES, 64);
  assert.doesNotThrow(() => validateScenarioName("a".repeat(64)));
  assert.doesNotThrow(() => validateScenarioName("é".repeat(32)));
  for (const name of ["", " padded", "padded ", "line\nbreak", "a".repeat(65), "é".repeat(33)]) {
    assert.throws(() => validateScenarioName(name));
  }
});

test("verifies canonical fixed-size scenario definitions", async () => {
  const anchorPositionId = conditionId(17);
  const [scenarioAddress, bump] = await getScenarioAddress(creator, anchorPositionId);
  const scenario: Account<ScenarioDefinition> = {
    address: scenarioAddress,
    data: {
      discriminator: getScenarioDefinitionDiscriminatorBytes(),
      version: 1,
      creator,
      anchorPositionId,
      registeredSlot: 91n,
      bump,
      name: "SOL/USD at expiry",
    },
    executable: false,
    lamports: lamports(1n),
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    space: SCENARIO_DEFINITION_SPACE,
  };

  assert.equal(await verifyScenarioDefinitionAccount(scenario), scenario);
  await assert.rejects(
    () => verifyScenarioDefinitionAccount({ ...scenario, address: collateralMint }),
    /canonical PDA/,
  );
  await assert.rejects(
    () =>
      verifyScenarioDefinitionAccount({
        ...scenario,
        data: { ...scenario.data, name: " padded" },
      }),
    /name is invalid/,
  );
});

test("plans zero-balance scenario anchors beyond sixteen factors", async () => {
  const payer = await generateKeyPairSigner();
  const factors = Array.from({ length: 17 }, () => factor(23));
  const plan = await planScenarioAnchor({
    payer,
    creator: payer,
    collateralMint,
    factors,
    mode: "product",
    name: "Repeated product",
  });

  assert.equal(plan.factors.length, 17);
  assert.equal(plan.setupInstructions.length, 18);
  assert.deepEqual(plan.anchorPositionId, derivePositionId(collateralMint, plan.collectionId));
  assert.equal(plan.registerScenarioInstruction.accounts?.[0]?.address, payer.address);
  assert.equal(plan.registerScenarioInstruction.accounts?.[1]?.address, payer.address);
});

test("classifies exact and compatible participation with multiplicity", () => {
  const scenario = {
    anchor: {
      position: { data: { collateralMint } },
      collection: { factors: [factor(1), factor(1), factor(2)] },
    },
  } as unknown as Pick<VerifiedScenario, "anchor">;
  const classify = (mint: Address, factors: readonly ConditionClause[]) =>
    classifyScenarioParticipation(scenario, { collateralMint: mint, factors });

  assert.equal(classify(collateralMint, [factor(2), factor(1), factor(1)]), "exact");
  assert.equal(classify(collateralMint, [factor(1), factor(2)]), "compatible");
  assert.equal(classify(collateralMint, [factor(1), factor(1), factor(1)]), "unrelated");
  assert.equal(classify(creator, [factor(1)]), "unrelated");
  assert.equal(classify(collateralMint, []), "unrelated");
});
