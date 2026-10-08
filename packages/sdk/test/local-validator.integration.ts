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
  type Signature,
} from "@solana/kit";
import {
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import {
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getCreateMintInstructionPlan,
  getMintToInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import {
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  CC_TOKEN_PROGRAM_ADDRESS,
  CollateralFreezeAuthority,
  createKitExecutionAdapter,
  DefinitionVerificationError,
  fetchPositionHoldings,
  fetchVerifiedCollection,
  fetchVerifiedCondition,
  fetchVerifiedPosition,
  fetchVerifiedPositionBalance,
  fetchVerifiedWrapper,
  fetchVerifiedWrapperByMint,
  executeConfirmedPlan,
  getAppendPayoutReportInstruction,
  getBatchTransferNativePositionsInstruction,
  getBatchTransferSetupInstructions,
  getCollateralAddress,
  getCollectionAddress,
  getClosePositionBalanceInstruction,
  getConditionAddress,
  getFinalizePayoutReportInstruction,
  getInitializePositionBalanceInstruction,
  getInitializeCanonicalWrapperInstruction,
  getMergeRootCollateralInstruction,
  getMergeNativePositionsInstruction,
  getInitializePayoutReportInstruction,
  getPayoutReportAddress,
  getPrepareConditionInstruction,
  getRegisterCollateralInstructionAsync,
  getRegisterCollectionInstruction,
  getRegisterPositionForCollectionInstruction,
  getRedeemNativePositionInstruction,
  getRedeemRootCollateralInstruction,
  getRootCollateralSetupInstructions,
  getCreateWrapperTokenAccountInstruction,
  getReportPayoutsInstruction,
  getVaultAuthorityAddress,
  getSplitRootCollateralInstruction,
  getSplitNativePositionInstruction,
  getNativePositionSetupInstructions,
  getTransferNativePositionInstruction,
  getUnwrapWrappedPositionInstruction,
  getWrapNativePositionInstruction,
  getWrapperMintAddress,
  planPayoutReport,
  MemoryPlanCheckpointStore,
  PlanExecutionError,
  type PreparedCcTokenTransaction,
  ROOT_COLLECTION_ID,
  selectTransactionVersion,
  TOKEN_2022_PROGRAM_ADDRESS,
  type CcTokenTransactionVersion,
} from "../src/index.ts";
import {
  fetchCollateralConfig,
  fetchCollectionDefinition,
  fetchCondition,
  fetchMaybePayoutReport,
  fetchPayoutReport,
} from "../src/generated/index.ts";

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

test("generated client submits the native lifecycle through v0 and v1", async () => {
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

  const [configAddress, configBump] = await getCollateralAddress(mint.address);
  const [vaultAuthority, vaultAuthorityBump] = await getVaultAuthorityAddress(mint.address);
  const registerCollateral = await getRegisterCollateralInstructionAsync({ payer, mint });
  await sendInstruction(payer, registerCollateral, v0Only);

  const config = await fetchCollateralConfig(rpc, configAddress);
  assert.equal(config.programAddress, CC_TOKEN_PROGRAM_ADDRESS);
  assert.equal(config.data.version, 1);
  assert.equal(config.data.policyVersion, 2);
  assert.equal(config.data.mint, mint.address);
  assert.equal(config.data.tokenProgram, TOKEN_PROGRAM_ADDRESS);
  assert.equal(config.data.decimals, 6);
  assert.equal(config.data.freezeAuthority, CollateralFreezeAuthority.Unfreezable);
  assert.equal(config.data.bump, configBump);
  assert.equal(config.data.vaultAuthorityBump, vaultAuthorityBump);

  const vault = await fetchToken(rpc, config.data.vault);
  assert.equal(vault.programAddress, TOKEN_PROGRAM_ADDRESS);
  assert.equal(vault.data.mint, mint.address);
  assert.equal(vault.data.owner, vaultAuthority);
  assert.equal(vault.data.amount, 0n);

  const [ownerTokenAccount] = await findAssociatedTokenPda({
    owner: payer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mint.address,
  });
  await sendInstructions(
    payer,
    [
      getCreateAssociatedTokenInstruction({
        payer,
        ata: ownerTokenAccount,
        owner: payer.address,
        mint: mint.address,
      }),
      getMintToInstruction({
        mint: mint.address,
        token: ownerTokenAccount,
        mintAuthority: payer,
        amount: 1_000n,
      }),
    ],
    v0Only,
  );

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

  const positionId = derivePositionId(mint.address, collectionId);
  await sendInstruction(
    payer,
    await getRegisterPositionForCollectionInstruction({
      payer,
      collateralMint: mint.address,
      collectionId,
    }),
    v0Only,
  );
  const verifiedPosition = await fetchVerifiedPosition(rpc, mint.address, collectionId);
  assert.deepEqual(verifiedPosition.position.data.positionId, positionId);
  assert.equal(verifiedPosition.position.data.collateralMint, mint.address);
  assert.deepEqual(verifiedPosition.position.data.collectionId, collectionId);

  await sendInstruction(
    payer,
    await getInitializePositionBalanceInstruction({
      payer,
      owner: payer.address,
      positionId,
    }),
    v0Only,
  );

  const rootPartition = [
    [0x0fn, 0n, 0n, 0n],
    [0xf0n, 0n, 0n, 0n],
  ] as const;
  const rootSetup = await getRootCollateralSetupInstructions({
    payer,
    owner: payer.address,
    collateralMint: mint.address,
    conditionId,
    outcomeCount: 8,
    partition: rootPartition,
  });
  for (const instruction of rootSetup) {
    await sendInstruction(payer, instruction, v0Only);
  }
  const rootInput = {
    owner: payer,
    ownerTokenAccount,
    collateralMint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    conditionId,
    outcomeCount: 8,
    partition: rootPartition,
    amount: 300n,
  } as const;
  await sendInstruction(payer, await getSplitRootCollateralInstruction(rootInput), v0Only);
  assert.equal((await fetchToken(rpc, ownerTokenAccount)).data.amount, 700n);
  assert.equal((await fetchToken(rpc, config.data.vault)).data.amount, 300n);
  const rootPositionIds = rootPartition.map((indexSet) => {
    const rootCollectionId = deriveCollectionId(
      ROOT_COLLECTION_ID,
      conditionId,
      indexSet,
    ).collectionId;
    return derivePositionId(mint.address, rootCollectionId);
  });
  for (const indexSet of rootPartition) {
    const rootCollectionId = deriveCollectionId(
      ROOT_COLLECTION_ID,
      conditionId,
      indexSet,
    ).collectionId;
    const rootPositionId = derivePositionId(mint.address, rootCollectionId);
    const balance = await fetchVerifiedPositionBalance(rpc, payer.address, rootPositionId);
    assert.equal(balance.exists, true);
    if (!balance.exists) throw new Error("expected a root child balance");
    assert.equal(balance.account.data.amount, 300n);
  }

  const refinementPartition = [
    [0x03n, 0n, 0n, 0n],
    [0x0cn, 0n, 0n, 0n],
  ] as const;
  const refinementSetup = await getNativePositionSetupInstructions({
    payer,
    owner: payer.address,
    collateralMint: mint.address,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    outcomeCount: 8,
    partition: refinementPartition,
  });
  for (const instruction of refinementSetup) {
    await sendInstruction(payer, instruction, v0Only);
  }
  const refinementInput = {
    owner: payer,
    collateralMint: mint.address,
    parentCollectionId: ROOT_COLLECTION_ID,
    conditionId,
    outcomeCount: 8,
    partition: refinementPartition,
    amount: 100n,
  } as const;
  await sendInstruction(payer, await getSplitNativePositionInstruction(refinementInput), v0Only);
  const groupedCollectionId = deriveCollectionId(
    ROOT_COLLECTION_ID,
    conditionId,
    rootPartition[0],
  ).collectionId;
  const groupedPositionId = derivePositionId(mint.address, groupedCollectionId);
  const groupedBalance = await fetchVerifiedPositionBalance(rpc, payer.address, groupedPositionId);
  assert.equal(groupedBalance.exists, true);
  if (!groupedBalance.exists) throw new Error("expected a grouped source balance");
  assert.equal(groupedBalance.account.data.amount, 200n);
  for (const indexSet of refinementPartition) {
    const refinedCollectionId = deriveCollectionId(
      ROOT_COLLECTION_ID,
      conditionId,
      indexSet,
    ).collectionId;
    const refinedPositionId = derivePositionId(mint.address, refinedCollectionId);
    const balance = await fetchVerifiedPositionBalance(rpc, payer.address, refinedPositionId);
    assert.equal(balance.exists, true);
    if (!balance.exists) throw new Error("expected a refined position balance");
    assert.equal(balance.account.data.amount, 100n);
  }
  await sendInstruction(payer, await getMergeNativePositionsInstruction(refinementInput), v0Only);
  const restoredGroupedBalance = await fetchVerifiedPositionBalance(
    rpc,
    payer.address,
    groupedPositionId,
  );
  assert.equal(restoredGroupedBalance.exists, true);
  if (!restoredGroupedBalance.exists) throw new Error("expected a restored grouped balance");
  assert.equal(restoredGroupedBalance.account.data.amount, 300n);
  assert.equal((await fetchToken(rpc, ownerTokenAccount)).data.amount, 700n);
  assert.equal((await fetchToken(rpc, config.data.vault)).data.amount, 300n);

  const transferRecipient = await generateKeyPairSigner();
  await sendInstruction(
    payer,
    await getTransferNativePositionInstruction({
      owner: payer,
      recipient: transferRecipient.address,
      positionId: rootPositionIds[0]!,
      amount: 40n,
    }),
    v0Only,
  );
  let payerFirstBalance = await fetchVerifiedPositionBalance(
    rpc,
    payer.address,
    rootPositionIds[0]!,
  );
  let recipientFirstBalance = await fetchVerifiedPositionBalance(
    rpc,
    transferRecipient.address,
    rootPositionIds[0]!,
  );
  assert.equal(payerFirstBalance.exists && payerFirstBalance.account.data.amount, 260n);
  assert.equal(recipientFirstBalance.exists && recipientFirstBalance.account.data.amount, 40n);
  await sendInstruction(
    payer,
    await getTransferNativePositionInstruction({
      owner: transferRecipient,
      recipient: payer.address,
      positionId: rootPositionIds[0]!,
      amount: 10n,
    }),
    v0Only,
  );

  const batchTransfers = rootPositionIds.map((positionId, index) => ({
    positionId,
    amount: index === 0 ? 20n : 25n,
  }));
  const batchSetup = await getBatchTransferSetupInstructions({
    payer,
    recipient: transferRecipient.address,
    transfers: batchTransfers,
  });
  for (const instruction of batchSetup) {
    await sendInstruction(payer, instruction, v0Only);
  }
  await sendInstruction(
    payer,
    await getBatchTransferNativePositionsInstruction({
      owner: payer,
      recipient: transferRecipient.address,
      transfers: batchTransfers,
    }),
    v0Only,
  );
  payerFirstBalance = await fetchVerifiedPositionBalance(rpc, payer.address, rootPositionIds[0]!);
  recipientFirstBalance = await fetchVerifiedPositionBalance(
    rpc,
    transferRecipient.address,
    rootPositionIds[0]!,
  );
  assert.equal(payerFirstBalance.exists && payerFirstBalance.account.data.amount, 250n);
  assert.equal(recipientFirstBalance.exists && recipientFirstBalance.account.data.amount, 50n);
  await sendInstruction(
    payer,
    await getBatchTransferNativePositionsInstruction({
      owner: transferRecipient,
      recipient: payer.address,
      transfers: [
        { positionId: rootPositionIds[0]!, amount: 50n },
        { positionId: rootPositionIds[1]!, amount: 25n },
      ],
    }),
    v0Only,
  );
  for (const positionId of rootPositionIds) {
    const payerBalance = await fetchVerifiedPositionBalance(rpc, payer.address, positionId);
    const recipientBalance = await fetchVerifiedPositionBalance(
      rpc,
      transferRecipient.address,
      positionId,
    );
    assert.equal(payerBalance.exists && payerBalance.account.data.amount, 300n);
    assert.equal(recipientBalance.exists && recipientBalance.account.data.amount, 0n);
  }

  await sendInstruction(
    payer,
    await getInitializeCanonicalWrapperInstruction({
      payer,
      collateralMint: mint.address,
      positionId: rootPositionIds[0]!,
    }),
    v0Only,
  );
  const [wrapperMint] = await getWrapperMintAddress(rootPositionIds[0]!);
  const [otherWrapperMint] = await getWrapperMintAddress(rootPositionIds[1]!);
  assert.notEqual(wrapperMint, otherWrapperMint);
  await sendInstruction(
    payer,
    await getInitializeCanonicalWrapperInstruction({
      payer,
      collateralMint: mint.address,
      positionId: rootPositionIds[1]!,
    }),
    v0Only,
  );
  const verifiedWrapper = await fetchVerifiedWrapper(rpc, rootPositionIds[0]!);
  assert.equal(verifiedWrapper.mint.address, wrapperMint);
  assert.deepEqual(verifiedWrapper.config.data.positionId, rootPositionIds[0]!);
  assert.equal(
    (await fetchVerifiedWrapperByMint(rpc, wrapperMint)).position.address,
    verifiedWrapper.position.address,
  );

  await sendInstructions(
    payer,
    [
      await getCreateWrapperTokenAccountInstruction({
        payer,
        owner: payer.address,
        positionId: rootPositionIds[0]!,
      }),
      await getCreateWrapperTokenAccountInstruction({
        payer,
        owner: transferRecipient.address,
        positionId: rootPositionIds[0]!,
      }),
    ],
    v0Only,
  );
  const [payerWrapperAccount] = await findAssociatedTokenPda({
    owner: payer.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    mint: wrapperMint,
  });
  const [recipientWrapperAccount] = await findAssociatedTokenPda({
    owner: transferRecipient.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    mint: wrapperMint,
  });
  await sendInstruction(
    payer,
    await getWrapNativePositionInstruction({
      owner: payer,
      positionId: rootPositionIds[0]!,
      amount: 60n,
    }),
    v0Only,
  );
  const payerWrapper = await fetchToken(rpc, payerWrapperAccount);
  assert.equal(payerWrapper.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
  assert.equal(payerWrapper.data.owner, payer.address);
  assert.equal(payerWrapper.data.mint, wrapperMint);
  assert.equal(payerWrapper.data.amount, 60n);
  assert.equal((await fetchMint(rpc, wrapperMint)).data.supply, 60n);
  const wrappedPayerBalance = await fetchVerifiedPositionBalance(
    rpc,
    payer.address,
    rootPositionIds[0]!,
  );
  assert.equal(wrappedPayerBalance.exists && wrappedPayerBalance.account.data.amount, 240n);
  const payerHoldings = await fetchPositionHoldings(rpc, payer.address, rootPositionIds[0]!);
  assert.equal(payerHoldings.nativeAmount, 240n);
  assert.equal(payerHoldings.wrapper?.amount, 60n);
  assert.equal(payerHoldings.totalAmount, 300n);

  await sendInstruction(
    payer,
    getTransferCheckedInstruction(
      {
        source: payerWrapperAccount,
        mint: wrapperMint,
        destination: recipientWrapperAccount,
        authority: payer,
        amount: 60n,
        decimals: 6,
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
    ),
    v0Only,
  );
  const transferredHoldings = await fetchPositionHoldings(
    rpc,
    transferRecipient.address,
    rootPositionIds[0]!,
  );
  assert.equal(transferredHoldings.nativeAmount, 0n);
  assert.equal(transferredHoldings.wrapper?.amount, 60n);
  assert.equal(transferredHoldings.totalAmount, 60n);
  await fund(transferRecipient.address);
  await sendInstruction(
    payer,
    await getUnwrapWrappedPositionInstruction({
      owner: transferRecipient,
      positionId: rootPositionIds[0]!,
      amount: 60n,
    }),
    v0Only,
  );
  assert.equal((await fetchToken(rpc, recipientWrapperAccount)).data.amount, 0n);
  assert.equal((await fetchMint(rpc, wrapperMint)).data.supply, 0n);
  const unwrappedRecipientBalance = await fetchVerifiedPositionBalance(
    rpc,
    transferRecipient.address,
    rootPositionIds[0]!,
  );
  assert.equal(
    unwrappedRecipientBalance.exists && unwrappedRecipientBalance.account.data.amount,
    60n,
  );
  const unwrappedHoldings = await fetchPositionHoldings(
    rpc,
    transferRecipient.address,
    rootPositionIds[0]!,
  );
  assert.equal(unwrappedHoldings.nativeAmount, 60n);
  assert.equal(unwrappedHoldings.wrapper?.amount, 0n);
  assert.equal(unwrappedHoldings.totalAmount, 60n);
  await sendInstruction(
    payer,
    await getTransferNativePositionInstruction({
      owner: transferRecipient,
      recipient: payer.address,
      positionId: rootPositionIds[0]!,
      amount: 60n,
    }),
    v0Only,
  );

  const redemptionQuestionId = new Uint8Array(32).fill(18);
  const redemptionConditionId = deriveConditionId(payer.address, redemptionQuestionId, 2);
  const [redemptionConditionAddress] = await getConditionAddress(redemptionConditionId);
  await sendInstruction(
    payer,
    getPrepareConditionInstruction({
      payer,
      condition: redemptionConditionAddress,
      conditionId: redemptionConditionId,
      resolver: payer.address,
      questionId: redemptionQuestionId,
      outcomeCount: 2,
    }),
    v0Only,
  );
  const redemptionPartition = [
    [1n, 0n, 0n, 0n],
    [2n, 0n, 0n, 0n],
  ] as const;
  const redemptionSetup = await getNativePositionSetupInstructions({
    payer,
    owner: payer.address,
    collateralMint: mint.address,
    parentCollectionId: groupedCollectionId,
    conditionId: redemptionConditionId,
    outcomeCount: 2,
    partition: redemptionPartition,
  });
  for (const instruction of redemptionSetup) {
    await sendInstruction(payer, instruction, v0Only);
  }
  await sendInstruction(
    payer,
    await getSplitNativePositionInstruction({
      owner: payer,
      collateralMint: mint.address,
      parentCollectionId: groupedCollectionId,
      conditionId: redemptionConditionId,
      outcomeCount: 2,
      partition: redemptionPartition,
      amount: 100n,
    }),
    v0Only,
  );
  await sendInstruction(
    payer,
    getReportPayoutsInstruction({
      resolver: payer,
      condition: redemptionConditionAddress,
      payoutNumerators: [1n, 1n],
    }),
    v0Only,
  );
  for (const indexSet of redemptionPartition) {
    await sendInstruction(
      payer,
      await getRedeemNativePositionInstruction({
        owner: payer,
        collateralMint: mint.address,
        parentCollectionId: groupedCollectionId,
        conditionId: redemptionConditionId,
        outcomeCount: 2,
        indexSet,
        amount: 100n,
      }),
      v0Only,
    );
  }
  const redeemedGroupedBalance = await fetchVerifiedPositionBalance(
    rpc,
    payer.address,
    groupedPositionId,
  );
  assert.equal(redeemedGroupedBalance.exists && redeemedGroupedBalance.account.data.amount, 300n);

  await sendInstruction(
    payer,
    getReportPayoutsInstruction({
      resolver: payer,
      condition: conditionAddress,
      payoutNumerators: Array<bigint>(8).fill(1n),
    }),
    v0Only,
  );
  for (let index = 0; index < rootPartition.length; index += 1) {
    await sendInstruction(
      payer,
      await getRedeemRootCollateralInstruction({
        owner: payer,
        ownerTokenAccount,
        collateralMint: mint.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        conditionId,
        outcomeCount: 8,
        indexSet: rootPartition[index]!,
        amount: 100n,
      }),
      v0Only,
    );
  }
  assert.equal((await fetchToken(rpc, ownerTokenAccount)).data.amount, 800n);
  assert.equal((await fetchToken(rpc, config.data.vault)).data.amount, 200n);

  await sendInstruction(
    payer,
    await getMergeRootCollateralInstruction({ ...rootInput, amount: 200n }),
    v0Only,
  );
  assert.equal((await fetchToken(rpc, ownerTokenAccount)).data.amount, 1_000n);
  assert.equal((await fetchToken(rpc, config.data.vault)).data.amount, 0n);
  const openBalance = await fetchVerifiedPositionBalance(rpc, payer.address, positionId);
  assert.equal(openBalance.exists, true);
  if (!openBalance.exists) throw new Error("expected an open native position balance");
  assert.equal(openBalance.account.data.amount, 0n);

  await sendInstruction(
    payer,
    await getClosePositionBalanceInstruction({ owner: payer, positionId }),
    v0Only,
  );
  assert.equal((await fetchVerifiedPositionBalance(rpc, payer.address, positionId)).exists, false);
  await sendInstruction(
    payer,
    await getInitializePositionBalanceInstruction({
      payer,
      owner: payer.address,
      positionId,
    }),
    v0Only,
  );

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

  const transferQuestionId = new Uint8Array(32).fill(31);
  const transferConditionId = deriveConditionId(payer.address, transferQuestionId, 16);
  const [transferConditionAddress] = await getConditionAddress(transferConditionId);
  await sendInstruction(
    payer,
    getPrepareConditionInstruction({
      payer,
      condition: transferConditionAddress,
      conditionId: transferConditionId,
      resolver: payer.address,
      questionId: transferQuestionId,
      outcomeCount: 16,
    }),
    v0Only,
  );
  const transferPartition = Array.from(
    { length: 16 },
    (_, index) => [1n << BigInt(index), 0n, 0n, 0n] as const,
  );
  const transferSetup = await getRootCollateralSetupInstructions({
    payer,
    owner: payer.address,
    collateralMint: mint.address,
    conditionId: transferConditionId,
    outcomeCount: 16,
    partition: transferPartition,
  });
  for (const instruction of transferSetup) {
    await sendInstruction(payer, instruction, v0Only);
  }
  await sendInstruction(
    payer,
    await getSplitRootCollateralInstruction({
      owner: payer,
      ownerTokenAccount,
      collateralMint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      conditionId: transferConditionId,
      outcomeCount: 16,
      partition: transferPartition,
      amount: 10n,
    }),
    v1Capable,
  );
  const transferPositionIds = transferPartition.map((indexSet) =>
    derivePositionId(
      mint.address,
      deriveCollectionId(ROOT_COLLECTION_ID, transferConditionId, indexSet).collectionId,
    ),
  );
  const resumableRecipient = await generateKeyPairSigner();
  const resumableTransfers = transferPositionIds.map((positionId) => ({
    positionId,
    amount: 1n,
  }));
  for (const instruction of await getBatchTransferSetupInstructions({
    payer,
    recipient: resumableRecipient.address,
    transfers: resumableTransfers,
  })) {
    await sendInstruction(payer, instruction, v0Only);
  }
  const resumableTransferInstruction = await getBatchTransferNativePositionsInstruction({
    owner: payer,
    recipient: resumableRecipient.address,
    transfers: resumableTransfers,
  });

  const recentSlot = await rpc.getSlot({ commitment: "finalized" }).send();
  const createLookupTable = await getCreateLookupTableInstructionAsync({
    authority: payer,
    payer,
    recentSlot,
  });
  const lookupTableAddress = createLookupTable.accounts[0].address;
  await sendInstruction(payer, createLookupTable, v0Only);
  const lookupAddresses = [
    ...new Set((resumableTransferInstruction.accounts ?? []).map((account) => account.address)),
  ];
  for (let offset = 0; offset < lookupAddresses.length; offset += 20) {
    await sendInstruction(
      payer,
      getExtendLookupTableInstruction({
        address: lookupTableAddress,
        authority: payer,
        payer,
        addresses: lookupAddresses.slice(offset, offset + 20),
      }),
      v0Only,
    );
  }
  const extensionSlot = await rpc.getSlot({ commitment: "confirmed" }).send();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await rpc.getSlot({ commitment: "confirmed" }).send()) > extensionSlot) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const resumableStep = {
    id: "resumable-alt-transfer:0",
    planId: "resumable-alt-transfer",
    kind: "execute",
    instructions: [resumableTransferInstruction],
  } as const;
  const checkpointStore = new MemoryPlanCheckpointStore<
    PreparedCcTokenTransaction,
    Signature,
    readonly bigint[]
  >();
  const refetchResumableBalances = async () =>
    Promise.all(
      transferPositionIds.map(async (positionId) => {
        const balance = await fetchVerifiedPositionBalance(
          rpc,
          resumableRecipient.address,
          positionId,
        );
        return balance.exists ? balance.account.data.amount : 0n;
      }),
    );
  const executionAdapter = createKitExecutionAdapter({
    rpc,
    feePayer: payer,
    checkpointStore,
    version: v0Only,
    lookupTableAddresses: [lookupTableAddress],
    computeUnitLimit: 300_000,
    confirmationPollIntervalMs: 100,
    async refetch() {
      return refetchResumableBalances();
    },
  });
  await assert.rejects(
    () =>
      executeConfirmedPlan([resumableStep], {
        ...executionAdapter,
        async submit(transaction, step) {
          await executionAdapter.submit(transaction, step);
          throw new Error("RPC response lost after submission");
        },
      }),
    (error) => error instanceof PlanExecutionError && error.phase === "submission",
  );
  const submittedCheckpoint = await checkpointStore.load(resumableStep.planId, resumableStep.id);
  assert.equal(submittedCheckpoint?.status, "prepared");
  if (!submittedCheckpoint) throw new Error("expected a prepared transfer checkpoint");
  const resumedReceipts = await executeConfirmedPlan([resumableStep], executionAdapter);
  assert.equal(resumedReceipts[0]?.signature, submittedCheckpoint.signature);
  assert.deepEqual(resumedReceipts[0]?.state, Array<bigint>(16).fill(1n));
  for (const positionId of transferPositionIds) {
    const ownerBalance = await fetchVerifiedPositionBalance(rpc, payer.address, positionId);
    assert.equal(ownerBalance.exists && ownerBalance.account.data.amount, 9n);
  }
});
