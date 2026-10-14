import {
  complementIndexSet,
  createKitExecutionAdapter,
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  executeConfirmedPlan,
  generatedClient,
  getCollectionAddress,
  getConditionAddress,
  getCreateWrapperTokenAccountInstruction,
  getInitializeCanonicalWrapperInstruction,
  getInitializePositionBalanceInstruction,
  getMergeNativePositionsInstruction,
  getMergeRootCollateralInstruction,
  getNativePositionSetupInstructions,
  getPrepareConditionInstruction,
  getPositionBalanceAddress,
  getRedeemNativePositionInstruction,
  getRedeemNativePositionSetupInstructions,
  getRedeemRootCollateralInstruction,
  getRegisterCollateralInstructionAsync,
  getRegisterCollectionInstruction,
  getScenarioAddress,
  getUpdateScenarioDefinitionNameInstruction,
  getReportPayoutsInstruction,
  getRootCollateralSetupInstructions,
  getSplitNativePositionInstruction,
  getSplitRootCollateralInstruction,
  getTransferNativePositionInstruction,
  getUnwrapWrappedPositionInstruction,
  getWrapNativePositionInstruction,
  planPayoutReport,
  planScenarioAnchor,
  ROOT_COLLECTION_ID,
  validatePartition,
  WebStoragePlanCheckpointStore,
  type CcTokenExecutionRpc,
  type ConditionClause,
  type IndexSetWords,
  type PreparedCcTokenTransaction,
  type TransactionInstructionPlanStep,
  type WebStorage,
} from "@cc-token/sdk";
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getCreateMintInstructionPlan,
  getMintToInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  address,
  fetchEncodedAccounts,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  sequentialInstructionPlan,
  summarizeTransactionPlanResult,
  type Address,
  type ClientWithGetMinimumBalance,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type GetSignaturesForAddressApi,
  type GetTokenAccountsByOwnerApi,
  type Instruction,
  type InstructionPlan,
  type ReadonlyUint8Array,
  type Rpc,
  type Signature,
  type TransactionPlanResult,
  type TransactionSigner,
} from "@solana/kit";

import type { ConditionRef } from "../scenario.ts";

// The parts of the Kit client the live page uses. `payer` is the connected wallet.
export type LiveClient = Readonly<{
  rpc: CcTokenExecutionRpc &
    Rpc<
      GetAccountInfoApi &
        GetMultipleAccountsApi &
        GetProgramAccountsApi &
        GetSignaturesForAddressApi &
        GetTokenAccountsByOwnerApi
    >;
  payer: TransactionSigner;
  getMinimumBalance: ClientWithGetMinimumBalance["getMinimumBalance"];
  sendTransactions: (input: InstructionPlan) => Promise<TransactionPlanResult>;
}>;

export type CollateralRef = Readonly<{
  mint: Address;
  tokenProgram: Address;
  // Set when the mint has a freeze authority: deposits then have to opt in.
  issuerControlled: boolean;
}>;

const { CcTokenInstruction, identifyCcTokenInstruction } = generatedClient;

// Where each idempotent setup instruction puts the account it creates.
const CREATED_ACCOUNT_INDEX: Readonly<Record<number, number>> = {
  [CcTokenInstruction.RegisterCollection]: 2,
  [CcTokenInstruction.RegisterPosition]: 3,
  [CcTokenInstruction.InitializeBalance]: 3,
  [CcTokenInstruction.InitializeWrapper]: 3,
};

// Instructions are packed into as few transactions as fit, and sent in order.
async function send(
  client: LiveClient,
  instructions: readonly (Instruction | InstructionPlan)[],
): Promise<readonly Signature[]> {
  const result = await client.sendTransactions(sequentialInstructionPlan([...instructions]));
  return summarizeTransactionPlanResult(result).successfulTransactions.map(
    (transaction) => transaction.context.signature,
  );
}

// A node reads at most 100 accounts per request, so a longer list is read in several.
const ACCOUNTS_PER_REQUEST = 100;

export async function inBatches<TAddress, TAccount>(
  addresses: readonly TAddress[],
  read: (batch: TAddress[]) => Promise<readonly TAccount[]>,
): Promise<TAccount[]> {
  const batches: TAddress[][] = [];
  for (let start = 0; start < addresses.length; start += ACCOUNTS_PER_REQUEST) {
    batches.push(addresses.slice(start, start + ACCOUNTS_PER_REQUEST));
  }
  return (await Promise.all(batches.map(read))).flat();
}

// Setup is idempotent on-chain, but skipping what already exists saves approvals and fees.
async function withoutExisting(
  client: LiveClient,
  setup: readonly Instruction[],
): Promise<readonly Instruction[]> {
  const targets = setup.map((instruction) => {
    const index = instruction.data
      ? CREATED_ACCOUNT_INDEX[identifyCcTokenInstruction({ data: instruction.data })]
      : undefined;
    return index === undefined ? null : (instruction.accounts?.[index]?.address ?? null);
  });
  const addresses = [...new Set(targets.filter((target) => target !== null))];
  const accounts = await inBatches(addresses, (batch) => fetchEncodedAccounts(client.rpc, batch));
  const settled = new Set<Address>(
    accounts.filter((account) => account.exists).map((account) => account.address),
  );
  return setup.filter((_, index) => {
    const target = targets[index]!;
    if (target === null) return true;
    if (settled.has(target)) return false;
    settled.add(target);
    return true;
  });
}

function collectionIdOf(factors: readonly ConditionClause[]): Uint8Array {
  return factors.reduce<Uint8Array>(
    (collectionId, factor) =>
      deriveCollectionId(collectionId, factor.conditionId, factor.indexSet).collectionId,
    ROOT_COLLECTION_ID,
  );
}

// A position can be reached in any factor order, so the order used here may never have been
// registered. Registers every collection from the root down to `factors`.
async function getCollectionPathInstructions(
  payer: TransactionSigner,
  factors: readonly ConditionClause[],
): Promise<readonly Instruction[]> {
  const instructions: Instruction[] = [];
  let parentCollectionId: Uint8Array = ROOT_COLLECTION_ID;
  let parentCollection: Address | undefined;
  for (const factor of factors) {
    const { collectionId } = deriveCollectionId(
      parentCollectionId,
      factor.conditionId,
      factor.indexSet,
    );
    const [[condition], [collection]] = await Promise.all([
      getConditionAddress(factor.conditionId),
      getCollectionAddress(collectionId),
    ]);
    instructions.push(
      getRegisterCollectionInstruction({
        payer,
        condition,
        collection,
        parentCollection,
        collectionId,
        parentCollectionId,
        conditionId: factor.conditionId,
        indexSet: { words: [...factor.indexSet] },
      }),
    );
    parentCollectionId = collectionId;
    parentCollection = collection;
  }
  return instructions;
}

async function ownerTokenAccount(client: LiveClient, collateral: CollateralRef) {
  const [ata] = await findAssociatedTokenPda({
    owner: client.payer.address,
    tokenProgram: collateral.tokenProgram,
    mint: collateral.mint,
  });
  return {
    ata,
    create: getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata,
      owner: client.payer.address,
      mint: collateral.mint,
      tokenProgram: collateral.tokenProgram,
    }),
  };
}

// The program takes only plain mints as collateral, so a name cannot live on the mint itself.
// Wallets and explorers read it from the Metaplex metadata account instead.
export const METADATA_PROGRAM_ADDRESS = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const TEST_TOKEN_NAME = { name: "cc-token test collateral", symbol: "TEST" } as const;

export async function getMetadataAddress(mint: Address): Promise<Address> {
  const [metadata] = await getProgramDerivedAddress({
    programAddress: METADATA_PROGRAM_ADDRESS,
    seeds: [
      "metadata",
      getAddressEncoder().encode(METADATA_PROGRAM_ADDRESS),
      getAddressEncoder().encode(mint),
    ],
  });
  return metadata;
}

// Metaplex CreateMetadataAccountV3, signed by the mint authority. Written out by hand to avoid
// a dependency for one instruction.
// What the metadata program accepts, in UTF-8 bytes.
export const TOKEN_NAME_BYTES = 32;
export const TOKEN_SYMBOL_BYTES = 10;

// Why a name and symbol cannot be used, or null when they can.
export function tokenLabelProblem(
  label: Readonly<{ name: string; symbol: string }>,
): string | null {
  const size = (value: string) => new TextEncoder().encode(value).length;
  if (label.name.trim() === "" || size(label.name) > TOKEN_NAME_BYTES) {
    return `A token name is 1 to ${TOKEN_NAME_BYTES} bytes.`;
  }
  if (label.symbol.trim() === "" || size(label.symbol) > TOKEN_SYMBOL_BYTES) {
    return `A token symbol is 1 to ${TOKEN_SYMBOL_BYTES} bytes.`;
  }
  return null;
}

export async function getNameTokenInstruction(
  authority: TransactionSigner,
  mint: Address,
  { name, symbol }: Readonly<{ name: string; symbol: string }> = TEST_TOKEN_NAME,
): Promise<Instruction> {
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return [bytes.length, 0, 0, 0, ...bytes];
  };
  return {
    programAddress: METADATA_PROGRAM_ADDRESS,
    accounts: [
      { address: await getMetadataAddress(mint), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: authority.address, role: AccountRole.READONLY_SIGNER, signer: authority },
      { address: authority.address, role: AccountRole.WRITABLE_SIGNER, signer: authority },
      { address: authority.address, role: AccountRole.READONLY },
      { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      33, // CreateMetadataAccountV3
      ...text(name),
      ...text(symbol),
      ...text(""), // no off-chain document
      0,
      0, // no royalty
      0, // no creators
      0, // no collection
      0, // no uses
      1, // the authority can change it later
      0, // not a collection
    ]),
  } as Instruction;
}

// Local validators do not carry the metadata program; devnet and mainnet do.
async function canNameTokens(client: LiveClient): Promise<boolean> {
  const [program] = await fetchEncodedAccounts(client.rpc, [METADATA_PROGRAM_ADDRESS]);
  return program!.exists && program!.executable;
}

// Gives a token made here before names were added the same name. Mint authority only.
export async function nameTestCollateral(
  client: LiveClient,
  collateral: CollateralRef,
): Promise<readonly Signature[]> {
  return send(client, [await getNameTokenInstruction(client.payer, collateral.mint)]);
}

// A new classic SPL token the wallet can mint, named and registered as collateral. One
// transaction.
export async function createTestCollateral(
  client: LiveClient,
  amount: bigint,
  decimals: number,
  // Shown by wallets and explorers, where the cluster has the metadata program.
  label: Readonly<{ name: string; symbol: string }> = TEST_TOKEN_NAME,
): Promise<Readonly<{ mint: Address; signatures: readonly Signature[] }>> {
  const payer = client.payer;
  const mint = await generateKeyPairSigner();
  const collateral = {
    mint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    issuerControlled: false,
  };
  const { ata, create } = await ownerTokenAccount(client, collateral);
  const signatures = await send(client, [
    await getCreateMintInstructionPlan(client, {
      payer,
      newMint: mint,
      decimals,
      mintAuthority: payer.address,
      freezeAuthority: null,
    }),
    create,
    getMintToInstruction({ mint: mint.address, token: ata, mintAuthority: payer, amount }),
    ...((await canNameTokens(client))
      ? [await getNameTokenInstruction(payer, mint.address, label)]
      : []),
    await getRegisterCollateralInstructionAsync({ payer, mint: mint.address }),
  ]);
  return { mint: mint.address, signatures };
}

// Only works while the wallet is the mint authority, as it is for a test token made here.
export async function mintTestCollateral(
  client: LiveClient,
  collateral: CollateralRef,
  amount: bigint,
): Promise<readonly Signature[]> {
  const { ata, create } = await ownerTokenAccount(client, collateral);
  return send(client, [
    create,
    getMintToInstruction(
      { mint: collateral.mint, token: ata, mintAuthority: client.payer, amount },
      { programAddress: collateral.tokenProgram },
    ),
  ]);
}

// SOL as a token: a classic SPL account of this mint holds lamports and reports them as its
// balance. It is the one collateral every wallet on a cluster already has the means to get.
export const WRAPPED_SOL_MINT = address("So11111111111111111111111111111111111111112");
export const WRAPPED_SOL_LABEL = { name: "Wrapped SOL", symbol: "SOL" } as const;
const WRAPPED_SOL: CollateralRef = {
  mint: WRAPPED_SOL_MINT,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
  issuerControlled: false,
};

// System program Transfer, written out by hand to avoid a dependency for one instruction.
function getTransferSolInstruction(
  source: TransactionSigner,
  destination: Address,
  amount: bigint,
): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // Transfer
  view.setBigUint64(4, amount, true);
  return {
    programAddress: address("11111111111111111111111111111111"),
    accounts: [
      { address: source.address, role: AccountRole.WRITABLE_SIGNER, signer: source },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  } as Instruction;
}

// Moves SOL into the wallet's wrapped SOL account, where it can be deposited like any token.
export async function wrapSol(client: LiveClient, amount: bigint): Promise<readonly Signature[]> {
  const { ata, create } = await ownerTokenAccount(client, WRAPPED_SOL);
  return send(client, [
    create,
    getTransferSolInstruction(client.payer, ata, amount),
    getSyncNativeInstruction({ account: ata }),
  ]);
}

// Closes the wrapped SOL account, which returns all of it and the account's rent as SOL. The
// token program has no way to unwrap only a part.
export async function unwrapSol(client: LiveClient): Promise<readonly Signature[]> {
  const { ata } = await ownerTokenAccount(client, WRAPPED_SOL);
  return send(client, [
    getCloseAccountInstruction({
      account: ata,
      destination: client.payer.address,
      owner: client.payer,
    }),
  ]);
}

export async function registerCollateral(
  client: LiveClient,
  collateral: CollateralRef,
): Promise<readonly Signature[]> {
  return send(client, [
    await getRegisterCollateralInstructionAsync({
      payer: client.payer,
      mint: collateral.mint,
      tokenProgram: collateral.tokenProgram,
    }),
  ]);
}

export async function publishScenario(
  client: LiveClient,
  collateralMint: Address,
  name: string,
  factors: readonly ConditionClause[],
  mode: "logical" | "product",
): Promise<Readonly<{ address: Address; signatures: readonly Signature[] }>> {
  const plan = await planScenarioAnchor({
    payer: client.payer,
    creator: client.payer,
    collateralMint,
    factors,
    mode,
    name,
  });
  const setup = await withoutExisting(client, plan.setupInstructions);
  const signatures = await send(client, [...setup, plan.registerScenarioInstruction]);
  const [address] = await getScenarioAddress(client.payer.address, plan.anchorPositionId);
  return { address, signatures };
}

// The scenario this creator published for a position, if any. There is one per creator and
// position, so publishing it again would change nothing.
export async function findOwnScenario(
  rpc: LiveClient["rpc"],
  creator: Address,
  collateralMint: Address,
  factors: readonly ConditionClause[],
): Promise<Readonly<{ address: Address; name: string }> | null> {
  const positionId = derivePositionId(collateralMint, collectionIdOf(factors));
  const [scenario] = await getScenarioAddress(creator, positionId);
  const account = await generatedClient.fetchMaybeScenarioDefinition(rpc, scenario);
  return account.exists ? { address: scenario, name: account.data.name } : null;
}

export async function renameScenario(
  client: LiveClient,
  anchorPositionId: ReadonlyUint8Array,
  name: string,
): Promise<readonly Signature[]> {
  return send(client, [
    await getUpdateScenarioDefinitionNameInstruction({
      creator: client.payer,
      anchorPositionId,
      name,
    }),
  ]);
}

const MEMO_PROGRAM_ADDRESS = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// The connected wallet becomes the resolver, so only it can report the result later. `memo`
// publishes the question's wording in the same transaction, where other wallets can find it.
export async function prepareQuestion(
  client: LiveClient,
  questionId: Uint8Array,
  outcomeCount: number,
  memo: string | null = null,
): Promise<readonly Signature[]> {
  const resolver = client.payer.address;
  const conditionId = deriveConditionId(resolver, questionId, outcomeCount);
  const [condition] = await getConditionAddress(conditionId);
  return send(client, [
    getPrepareConditionInstruction({
      payer: client.payer,
      condition,
      conditionId,
      resolver,
      questionId,
      outcomeCount,
    }),
    ...(memo === null
      ? []
      : [{ programAddress: MEMO_PROGRAM_ADDRESS, data: new TextEncoder().encode(memo) }]),
  ]);
}

async function transitionInstructions(
  direction: "split" | "merge",
  client: LiveClient,
  collateral: CollateralRef,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Promise<readonly Instruction[]> {
  const owner = client.payer;
  const { conditionId, outcomeCount } = condition;
  const collateralMint = collateral.mint;

  // Only a full set of results at the root moves collateral in or out of the vault.
  if (parent.length === 0 && validatePartition(outcomeCount, partition).isFull) {
    const { ata, create } = await ownerTokenAccount(client, collateral);
    const input = {
      owner,
      ownerTokenAccount: ata,
      collateralMint,
      tokenProgram: collateral.tokenProgram,
      conditionId,
      outcomeCount,
      partition,
      amount,
      acceptIssuerControlled: collateral.issuerControlled,
    };
    if (direction === "merge") {
      return [create, await getMergeRootCollateralInstruction(input)];
    }
    const setup = await getRootCollateralSetupInstructions({
      payer: owner,
      owner: owner.address,
      collateralMint,
      conditionId,
      outcomeCount,
      partition,
    });
    return [
      ...(await withoutExisting(client, setup)),
      await getSplitRootCollateralInstruction(input),
    ];
  }

  const parentCollectionId = collectionIdOf(parent);
  const input = {
    owner,
    collateralMint,
    parentCollectionId,
    conditionId,
    outcomeCount,
    partition,
    amount,
  };
  const setup = [
    ...(await getCollectionPathInstructions(owner, parent)),
    ...(await getNativePositionSetupInstructions({
      payer: owner,
      owner: owner.address,
      collateralMint,
      parentCollectionId,
      conditionId,
      outcomeCount,
      partition,
    })),
  ];
  return [
    ...(await withoutExisting(client, setup)),
    direction === "split"
      ? await getSplitNativePositionInstruction(input)
      : await getMergeNativePositionsInstruction(input),
  ];
}

async function transition(
  direction: "split" | "merge",
  client: LiveClient,
  collateral: CollateralRef,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Promise<readonly Signature[]> {
  return send(
    client,
    await transitionInstructions(
      direction,
      client,
      collateral,
      parent,
      condition,
      partition,
      amount,
    ),
  );
}

// `parent` is the position being refined, without the question in `condition`.
export function split(
  client: LiveClient,
  collateral: CollateralRef,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Promise<readonly Signature[]> {
  return transition("split", client, collateral, parent, condition, partition, amount);
}

export type TakePositionOptions = Readonly<{
  operationId: string;
  storage: WebStorage;
  checkpointPrefix?: string;
  onStep?: (completed: number, total: number) => void | Promise<void>;
}>;

function takePositionPlanId(
  owner: Address,
  collateralMint: Address,
  path: readonly ConditionClause[],
  amount: bigint,
  operationId: string,
): string {
  return `take-position:${owner}:${collateralMint}:${bytesHex(collectionIdOf(path))}:${amount}:${operationId}`;
}

function takePositionStepId(depth: number): string {
  return `factor:${depth}`;
}

// Deposits and splits once per question, down to the position `path` names. Confirmed steps
// are reconciled from persistent checkpoints before any transaction is sent again.
export async function takePosition(
  client: LiveClient,
  collateral: CollateralRef,
  path: readonly ConditionClause[],
  amount: bigint,
  options: TakePositionOptions,
): Promise<readonly Signature[]> {
  const planId = takePositionPlanId(
    client.payer.address,
    collateral.mint,
    path,
    amount,
    options.operationId,
  );
  const checkpointStore = new WebStoragePlanCheckpointStore<
    PreparedCcTokenTransaction,
    Signature,
    bigint
  >(options.storage, options.checkpointPrefix);
  const signatures: Signature[] = [];
  for (let depth = 0; depth < path.length; depth += 1) {
    const { conditionId, outcomeCount, indexSet } = path[depth]!;
    const instructions = await transitionInstructions(
      "split",
      client,
      collateral,
      path.slice(0, depth),
      { conditionId, outcomeCount },
      [indexSet, complementIndexSet(outcomeCount, indexSet)],
      amount,
    );
    const transitionInstruction = instructions.at(-1);
    if (!transitionInstruction) throw new Error("a position acquisition step has no instructions");
    const setup = instructions.slice(0, -1);
    if (setup.length > 0) signatures.push(...(await send(client, setup)));
    const step: TransactionInstructionPlanStep = {
      id: takePositionStepId(depth),
      planId,
      kind: "execute",
      instructions: [transitionInstruction],
    };
    const factors = path.slice(0, depth + 1);
    const adapter = createKitExecutionAdapter({
      rpc: client.rpc,
      feePayer: client.payer,
      checkpointStore,
      version: 0,
      async refetch() {
        const positionId = derivePositionId(collateral.mint, collectionIdOf(factors));
        const [balance] = await getPositionBalanceAddress(client.payer.address, positionId);
        const account = await generatedClient.fetchMaybePositionBalance(client.rpc, balance);
        if (!account.exists) throw new Error("position balance was not found after confirmation");
        return account.data.amount;
      },
    });
    const [receipt] = await executeConfirmedPlan([step], adapter);
    if (!receipt) throw new Error("position acquisition step did not produce a receipt");
    signatures.push(receipt.signature);
    await options.onStep?.(depth + 1, path.length);
  }
  return signatures;
}

export async function clearTakePositionCheckpoints(
  owner: Address,
  collateralMint: Address,
  path: readonly ConditionClause[],
  amount: bigint,
  options: Pick<TakePositionOptions, "operationId" | "storage" | "checkpointPrefix">,
): Promise<void> {
  const store = new WebStoragePlanCheckpointStore(options.storage, options.checkpointPrefix);
  const planId = takePositionPlanId(owner, collateralMint, path, amount, options.operationId);
  await Promise.all(path.map((_, depth) => store.remove(planId, takePositionStepId(depth))));
}

function bytesHex(bytes: ReadonlyUint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function merge(
  client: LiveClient,
  collateral: CollateralRef,
  parent: readonly ConditionClause[],
  condition: ConditionRef,
  partition: readonly IndexSetWords[],
  amount: bigint,
): Promise<readonly Signature[]> {
  return transition("merge", client, collateral, parent, condition, partition, amount);
}

export async function reportPayouts(
  client: LiveClient,
  conditionId: Uint8Array,
  numerators: readonly bigint[],
): Promise<readonly Signature[]> {
  const plan = planPayoutReport(numerators, 0);
  if (plan.kind !== "direct") {
    throw new RangeError("this page reports at most 96 results in one transaction");
  }
  const [condition] = await getConditionAddress(conditionId);
  return send(client, [
    getReportPayoutsInstruction({
      resolver: client.payer,
      condition,
      payoutNumerators: [...plan.payoutNumerators],
    }),
  ]);
}

// Settles one question of a position: what is left is the position without that factor, or
// collateral when it was the only one.
export async function redeem(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  factorIndex: number,
  amount: bigint,
): Promise<readonly Signature[]> {
  return send(client, await redeemInstructions(client, collateral, factors, factorIndex, amount));
}

// Settles every question of a position, last one first, so each step leaves the position it
// was split from. `amounts` is what each step redeems, starting with the shares held.
export async function redeemAll(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  amounts: readonly bigint[],
): Promise<readonly Signature[]> {
  const instructions: Instruction[] = [];
  for (let depth = factors.length; depth > 0; depth -= 1) {
    const amount = amounts[factors.length - depth]!;
    if (amount === 0n) break;
    const prefix = factors.slice(0, depth);
    instructions.push(...(await redeemInstructions(client, collateral, prefix, depth - 1, amount)));
  }
  return send(client, instructions);
}

async function redeemInstructions(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  factorIndex: number,
  amount: bigint,
): Promise<readonly Instruction[]> {
  const owner = client.payer;
  const factor = factors[factorIndex];
  if (!factor) throw new RangeError("unknown position");
  const residual = factors.filter((_, index) => index !== factorIndex);
  const input = {
    owner,
    collateralMint: collateral.mint,
    conditionId: factor.conditionId,
    outcomeCount: factor.outcomeCount,
    indexSet: factor.indexSet,
    amount,
  };

  if (residual.length === 0) {
    const { ata, create } = await ownerTokenAccount(client, collateral);
    return [
      create,
      await getRedeemRootCollateralInstruction({
        ...input,
        ownerTokenAccount: ata,
        tokenProgram: collateral.tokenProgram,
      }),
    ];
  }

  const parentCollectionId = collectionIdOf(residual);
  const setup = [
    ...(await getCollectionPathInstructions(owner, residual)),
    ...(await getRedeemNativePositionSetupInstructions({
      payer: owner,
      collateralMint: collateral.mint,
      parentCollectionId,
    })),
  ];
  return [
    ...(await withoutExisting(client, setup)),
    await getRedeemNativePositionInstruction({ ...input, parentCollectionId }),
  ];
}

// Exchanges native shares for the position's Token-2022 token, one for one. The first wrap of
// a position also creates its token mint.
export async function wrap(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  amount: bigint,
): Promise<readonly Signature[]> {
  const owner = client.payer;
  const positionId = derivePositionId(collateral.mint, collectionIdOf(factors));
  const setup = [
    await getInitializeCanonicalWrapperInstruction({
      payer: owner,
      collateralMint: collateral.mint,
      positionId,
    }),
  ];
  return send(client, [
    ...(await withoutExisting(client, setup)),
    await getCreateWrapperTokenAccountInstruction({
      payer: owner,
      owner: owner.address,
      positionId,
    }),
    await getWrapNativePositionInstruction({ owner, positionId, amount }),
  ]);
}

// Burns the token and credits native shares. Works for tokens received from someone else: the
// native balance account is created if the wallet has none.
export async function unwrap(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  amount: bigint,
): Promise<readonly Signature[]> {
  const positionId = derivePositionId(collateral.mint, collectionIdOf(factors));
  return send(client, [
    await getUnwrapWrappedPositionInstruction({ owner: client.payer, positionId, amount }),
  ]);
}

// Moves native shares to another wallet, which needs no setup: its balance account is created
// here, paid by the sender, when it has none.
export async function transfer(
  client: LiveClient,
  collateral: CollateralRef,
  factors: readonly ConditionClause[],
  recipient: Address,
  amount: bigint,
): Promise<readonly Signature[]> {
  const owner = client.payer;
  const positionId = derivePositionId(collateral.mint, collectionIdOf(factors));
  const setup = [
    await getInitializePositionBalanceInstruction({ payer: owner, owner: recipient, positionId }),
  ];
  return send(client, [
    ...(await withoutExisting(client, setup)),
    await getTransferNativePositionInstruction({ owner, recipient, positionId, amount }),
  ]);
}
