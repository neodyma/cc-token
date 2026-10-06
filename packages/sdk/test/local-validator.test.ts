import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
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
  deriveCollectionId,
  deriveConditionId,
  fetchCollectionDefinition,
  fetchCondition,
  getCollectionAddress,
  getConditionAddress,
  getPrepareConditionInstruction,
  getRegisterCollectionInstruction,
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
  const latestBlockhash = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  if (version === 0) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayerSigner(payer, value),
      (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, value),
      (value) => appendTransactionMessageInstruction(instruction, value),
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
    (value) => appendTransactionMessageInstruction(instruction, value),
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

test("generated client submits v0 and optional v1 identity instructions", async () => {
  const payer = await generateKeyPairSigner();
  await fund(payer.address);

  const v0Only = selectTransactionVersion(new Set([0]));
  const v1Capable = selectTransactionVersion(new Set([0, 1]));
  assert.equal(v0Only, 0);
  assert.equal(v1Capable, 1);

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
});
