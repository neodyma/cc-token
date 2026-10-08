import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createClientWithGetMinimumBalanceFromRpc,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  fetchToken,
  getCreateMintInstructionPlan,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import {
  deriveCollectionId,
  deriveConditionId,
  CC_TOKEN_PROGRAM_ADDRESS,
  DefinitionVerificationError,
  fetchCollateralConfig,
  fetchCollectionDefinition,
  fetchCondition,
  fetchMaybePayoutReport,
  fetchPayoutReport,
  fetchVerifiedCollection,
  fetchVerifiedCondition,
  findConfigPda,
  findVaultAuthorityPda,
  getAppendPayoutReportInstruction,
  getCollectionAddress,
  getConditionAddress,
  getFinalizePayoutReportInstruction,
  getInitializePayoutReportInstruction,
  getPayoutReportAddress,
  getPrepareConditionInstruction,
  getRegisterCollateralInstructionAsync,
  getRegisterCollectionInstruction,
  getReportPayoutsInstruction,
  planPayoutReport,
  ROOT_COLLECTION_ID,
  selectTransactionVersion,
  type CcTokenTransactionVersion,
} from "../src/index.ts";

const rpcUrl = process.env.CC_TOKEN_RPC_URL;
const websocketUrl = process.env.CC_TOKEN_WS_URL;
if (!rpcUrl || !websocketUrl) throw new Error("local validator URLs are required");

const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(websocketUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

async function sendInstruction(
  payer: Awaited<ReturnType<typeof generateKeyPairSigner>>,
  instruction: Instruction,
  version: CcTokenTransactionVersion,
): Promise<void> {
  await sendInstructions(payer, [instruction], version);
}

async function sendInstructions(
  payer: Awaited<ReturnType<typeof generateKeyPairSigner>>,
  instructions: readonly Instruction[],
  version: CcTokenTransactionVersion,
): Promise<void> {
  const latestBlockhash = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  if (version === 0) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayerSigner(payer, value),
      (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(transaction);
    await sendAndConfirm(transaction, { commitment: "confirmed" });
    return;
  }

  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (value) => setTransactionMessageFeePayerSigner(payer, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
    (value) => setTransactionMessageComputeUnitLimit(1_400_000, value),
    (value) => setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, value),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  await sendAndConfirm(transaction, { commitment: "confirmed" });
}

async function fund(address: Address): Promise<void> {
  await rpc.requestAirdrop(address, lamports(2_000_000_000n), { commitment: "confirmed" }).send();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const balance = await rpc.getBalance(address, { commitment: "confirmed" }).send();
    if (balance.value > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("airdrop was not observed");
}

test("generated client submits identity and resolution instructions through v0 and v1", async () => {
  const payer = await generateKeyPairSigner();
  await fund(payer.address);

  const v0Only = selectTransactionVersion(new Set([0]));
  const v1Capable = selectTransactionVersion(new Set([0, 1]));
  assert.equal(v0Only, 0);
  assert.equal(v1Capable, 1);

  const mint = await generateKeyPairSigner();
  const mintPlan = await getCreateMintInstructionPlan(
    createClientWithGetMinimumBalanceFromRpc(rpc),
    {
      payer,
      newMint: mint,
      decimals: 6,
      mintAuthority: payer.address,
      freezeAuthority: null,
    },
  );
  assert.equal(mintPlan.kind, "sequential");
  const createMintInstructions = mintPlan.plans.map((plan) => {
    assert.equal(plan.kind, "single");
    if (plan.kind !== "single") throw new Error("expected single-instruction mint plan steps");
    return plan.instruction;
  });
  await sendInstructions(payer, createMintInstructions, v0Only);

  const [configAddress, configBump] = await findConfigPda({ mint: mint.address });
  const [vaultAuthority, vaultAuthorityBump] = await findVaultAuthorityPda({
    mint: mint.address,
  });
  const registerCollateral = await getRegisterCollateralInstructionAsync({ payer, mint });
  await sendInstruction(payer, registerCollateral, v0Only);

  const config = await fetchCollateralConfig(rpc, configAddress);
  assert.equal(config.programAddress, CC_TOKEN_PROGRAM_ADDRESS);
  assert.equal(config.data.version, 1);
  assert.equal(config.data.policyVersion, 1);
  assert.equal(config.data.mint, mint.address);
  assert.equal(config.data.tokenProgram, TOKEN_PROGRAM_ADDRESS);
  assert.equal(config.data.decimals, 6);
  assert.equal(config.data.bump, configBump);
  assert.equal(config.data.vaultAuthorityBump, vaultAuthorityBump);

  const vault = await fetchToken(rpc, config.data.vault);
  assert.equal(vault.programAddress, TOKEN_PROGRAM_ADDRESS);
  assert.equal(vault.data.mint, mint.address);
  assert.equal(vault.data.owner, vaultAuthority);
  assert.equal(vault.data.amount, 0n);

  const questionId = new Uint8Array(32).fill(17);
  const conditionId = deriveConditionId(payer.address, questionId, 8);
  const [conditionAddress] = await getConditionAddress(conditionId);
  const prepareCondition = getPrepareConditionInstruction({
    payer,
    condition: conditionAddress,
    conditionId,
    resolver: payer.address,
    questionId,
    outcomeCount: 8,
  });
  await sendInstruction(payer, prepareCondition, v0Only);

  const condition = await fetchCondition(rpc, conditionAddress);
  assert.deepEqual(condition.data.conditionId, conditionId);
  assert.equal(condition.data.outcomeCount, 8);

  const indexSet = [3n, 0n, 0n, 0n] as const;
  const { collectionId } = deriveCollectionId(ROOT_COLLECTION_ID, conditionId, indexSet);
  const [collectionAddress] = await getCollectionAddress(collectionId);
  const registerCollection = getRegisterCollectionInstruction({
    payer,
    condition: conditionAddress,
    collection: collectionAddress,
    collectionId,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    indexSet: { words: [...indexSet] },
  });
  await sendInstruction(payer, registerCollection, v0Only);

  const collection = await fetchCollectionDefinition(rpc, collectionAddress);
  assert.deepEqual(collection.data.collectionId, collectionId);
  assert.deepEqual(collection.data.conditionId, conditionId);
  assert.deepEqual(collection.data.indexSet.words, [...indexSet]);

  const v1IndexSet = [4n, 0n, 0n, 0n] as const;
  const v1CollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    conditionId,
    v1IndexSet,
  ).collectionId;
  const [v1CollectionAddress] = await getCollectionAddress(v1CollectionId);
  const v1Registration = getRegisterCollectionInstruction({
    payer,
    condition: conditionAddress,
    collection: v1CollectionAddress,
    collectionId: v1CollectionId,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    indexSet: { words: [...v1IndexSet] },
  });
  await sendInstruction(payer, v1Registration, v1Capable);
  assert.deepEqual(
    (await fetchCollectionDefinition(rpc, v1CollectionAddress)).data.collectionId,
    v1CollectionId,
  );

  const nestedCollectionId = deriveCollectionId(collectionId, conditionId, v1IndexSet).collectionId;
  assert.deepEqual(
    nestedCollectionId,
    deriveCollectionId(v1CollectionId, conditionId, indexSet).collectionId,
  );
  const [nestedCollectionAddress] = await getCollectionAddress(nestedCollectionId);
  await sendInstruction(
    payer,
    getRegisterCollectionInstruction({
      payer,
      condition: conditionAddress,
      collection: nestedCollectionAddress,
      parentCollection: collectionAddress,
      collectionId: nestedCollectionId,
      parentCollectionId: collectionId,
      conditionId,
      indexSet: { words: [...v1IndexSet] },
    }),
    v0Only,
  );
  await sendInstruction(
    payer,
    getRegisterCollectionInstruction({
      payer,
      condition: conditionAddress,
      collection: nestedCollectionAddress,
      parentCollection: v1CollectionAddress,
      collectionId: nestedCollectionId,
      parentCollectionId: v1CollectionId,
      conditionId,
      indexSet: { words: [...indexSet] },
    }),
    v0Only,
  );

  const verifiedNested = await fetchVerifiedCollection(rpc, nestedCollectionId);
  assert.equal(verifiedNested.constructionPath.length, 2);
  assert.equal(verifiedNested.factors.length, 2);
  assert.deepEqual(verifiedNested.constructionPath[0]?.collection.data.collectionId, collectionId);
  assert.deepEqual(
    verifiedNested.factors.map((factor) => factor.indexSet),
    [indexSet, v1IndexSet],
  );
  await assert.rejects(
    () => fetchVerifiedCollection(rpc, nestedCollectionId, { maxDepth: 1 }),
    (error) => error instanceof DefinitionVerificationError && error.code === "depth_limit",
  );

  const repeatedCollectionId = deriveCollectionId(collectionId, conditionId, indexSet).collectionId;
  const [repeatedCollectionAddress] = await getCollectionAddress(repeatedCollectionId);
  await sendInstruction(
    payer,
    getRegisterCollectionInstruction({
      payer,
      condition: conditionAddress,
      collection: repeatedCollectionAddress,
      parentCollection: collectionAddress,
      collectionId: repeatedCollectionId,
      parentCollectionId: collectionId,
      conditionId,
      indexSet: { words: [...indexSet] },
    }),
    v0Only,
  );
  const verifiedRepeated = await fetchVerifiedCollection(rpc, repeatedCollectionId);
  assert.equal(verifiedRepeated.factors.length, 2);
  assert.deepEqual(verifiedRepeated.factors[0]?.indexSet, indexSet);
  assert.deepEqual(verifiedRepeated.factors[1]?.indexSet, indexSet);

  const verifiedRoot = await fetchVerifiedCollection(rpc, ROOT_COLLECTION_ID);
  assert.deepEqual(verifiedRoot.factors, []);
  await assert.rejects(
    () => fetchVerifiedCollection(rpc, new Uint8Array(32).fill(99)),
    (error) => error instanceof DefinitionVerificationError && error.code === "missing_definition",
  );

  const directQuestionId = new Uint8Array(32).fill(23);
  const directConditionId = deriveConditionId(payer.address, directQuestionId, 256);
  const [directConditionAddress] = await getConditionAddress(directConditionId);
  await sendInstruction(
    payer,
    getPrepareConditionInstruction({
      payer,
      condition: directConditionAddress,
      conditionId: directConditionId,
      resolver: payer.address,
      questionId: directQuestionId,
      outcomeCount: 256,
    }),
    v0Only,
  );
  const directPayouts = Array<bigint>(256).fill(0n);
  directPayouts[127] = 1n;
  const directPlan = planPayoutReport(directPayouts, v1Capable);
  assert.equal(directPlan.kind, "direct");
  await sendInstruction(
    payer,
    getReportPayoutsInstruction({
      resolver: payer,
      condition: directConditionAddress,
      payoutNumerators: [...directPlan.payoutNumerators],
    }),
    v1Capable,
  );
  const directCondition = await fetchVerifiedCondition(rpc, directConditionId);
  assert.equal(directCondition.data.status, 1);
  assert.equal(directCondition.data.payoutDenominator, 1n);
  assert.deepEqual(directCondition.data.payoutNumerators, directPayouts);

  const stagedQuestionId = new Uint8Array(32).fill(29);
  const stagedConditionId = deriveConditionId(payer.address, stagedQuestionId, 256);
  const [stagedConditionAddress] = await getConditionAddress(stagedConditionId);
  const [payoutReportAddress] = await getPayoutReportAddress(stagedConditionId);
  await sendInstruction(
    payer,
    getPrepareConditionInstruction({
      payer,
      condition: stagedConditionAddress,
      conditionId: stagedConditionId,
      resolver: payer.address,
      questionId: stagedQuestionId,
      outcomeCount: 256,
    }),
    v0Only,
  );
  const stagedPayouts = Array<bigint>(256).fill(0n);
  stagedPayouts[255] = 7n;
  const stagedPlan = planPayoutReport(stagedPayouts, v0Only);
  assert.equal(stagedPlan.kind, "staged");
  if (stagedPlan.kind !== "staged") throw new Error("expected a staged payout report");

  await sendInstruction(
    payer,
    getInitializePayoutReportInstruction({
      payer,
      resolver: payer,
      condition: stagedConditionAddress,
      payoutReport: payoutReportAddress,
    }),
    v0Only,
  );
  for (const chunk of stagedPlan.chunks) {
    await sendInstruction(
      payer,
      getAppendPayoutReportInstruction({
        resolver: payer,
        condition: stagedConditionAddress,
        payoutReport: payoutReportAddress,
        payoutNumerators: [...chunk],
      }),
      v0Only,
    );
  }
  const pendingReport = await fetchPayoutReport(rpc, payoutReportAddress);
  assert.equal(pendingReport.data.payoutNumerators.length, 256);
  assert.equal(pendingReport.data.payoutDenominator, 7n);
  await sendInstruction(
    payer,
    getFinalizePayoutReportInstruction({
      resolver: payer,
      condition: stagedConditionAddress,
      payoutReport: payoutReportAddress,
      rentRefund: payer.address,
    }),
    v0Only,
  );

  const stagedCondition = await fetchVerifiedCondition(rpc, stagedConditionId);
  assert.equal(stagedCondition.data.status, 1);
  assert.equal(stagedCondition.data.payoutDenominator, 7n);
  assert.deepEqual(stagedCondition.data.payoutNumerators, stagedPayouts);
  assert.equal((await fetchMaybePayoutReport(rpc, payoutReportAddress)).exists, false);
});
