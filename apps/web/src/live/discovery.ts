import {
  CC_TOKEN_PROGRAM_ADDRESS,
  ConditionStatus,
  generatedClient,
  getCollateralAddress,
  getCollectionAddress,
  getConditionAddress,
  getPositionAddress,
  getWrapperAddress,
  getWrapperMintAddress,
  TOKEN_2022_PROGRAM_ADDRESS,
  type ConditionClause,
  type IndexSetWords,
} from "@cc-token/sdk";
import {
  fetchAllMaybeMint,
  fetchMaybeToken,
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  fetchEncodedAccounts,
  getAddressDecoder,
  getBase58Decoder,
  getBase64Encoder,
  isSolanaError,
  isSome,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
  type Address,
  type Base58EncodedBytes,
  type ReadonlyUint8Array,
  type Signature,
  type Slot,
} from "@solana/kit";

import { COLLATERAL_KEY, type Edge, type Ledger, type PositionNode } from "../ledger.ts";
import { holdingKey, toHex, type Holding } from "../scenario.ts";
import {
  getMetadataAddress,
  inBatches,
  METADATA_PROGRAM_ADDRESS,
  type CollateralRef,
  type LiveClient,
} from "./chain.ts";
import { questionFromMemo, type StoredQuestion } from "./questions.ts";

type LiveRpc = LiveClient["rpc"];

// Reads made after a transaction pass the slot it landed in. A node that has not caught up
// then refuses instead of answering with the state from before.
export type ReadConfig = Readonly<{ minContextSlot?: Slot }>;

export type LiveCollateral = CollateralRef &
  Readonly<{
    decimals: number;
    registered: boolean;
    // The wallet's own balance of the token, not locked in any position.
    free: bigint;
    // Whether the wallet can mint more, as it can for a test token made on this page.
    mintable: boolean;
    // From the token's metadata account, when it has one.
    label: TokenLabel | null;
  }>;

export type ChainCondition = Readonly<{
  conditionId: Uint8Array;
  questionId: Uint8Array;
  resolver: Address;
  outcomeCount: number;
  // Set once the resolver has reported.
  payouts: readonly bigint[] | null;
}>;

export type LivePosition = Readonly<{
  factors: readonly ConditionClause[];
  // The native balance, which is what splits, merges and redemptions act on.
  amount: bigint;
  // Held as the position's Token-2022 wrapper token instead.
  wrapped: bigint;
  // Known once the owner has a token account for the wrapper.
  wrapperMint: Address | null;
}>;

// PositionBalance: discriminator (8), version (1), owner (32), position ID (32), amount (8), bump.
const BALANCE_SIZE = 82n;
const BALANCE_OWNER_OFFSET = 9n;

// Repeats a read that a lagging node refused, until one that has caught up answers.
export async function whenCaughtUp<T>(read: () => Promise<T>, attempts = 20): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (
        attempt >= attempts ||
        !isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export type TokenLabel = Readonly<{ name: string; symbol: string }>;

// Metaplex metadata: key (1), update authority (32), mint (32), then name and symbol as
// length-prefixed strings padded with zero bytes.
const METADATA_KEY = 4;
const METADATA_NAME_OFFSET = 65;

export function decodeTokenLabel(data: ReadonlyUint8Array, mint: Address): TokenLabel | null {
  if (data[0] !== METADATA_KEY || data.length < METADATA_NAME_OFFSET + 8) return null;
  if (getAddressDecoder().decode(data.slice(33, 65)) !== mint) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = METADATA_NAME_OFFSET;
  const text = (): string | null => {
    if (offset + 4 > data.length) return null;
    const length = view.getUint32(offset, true);
    const end = offset + 4 + length;
    if (end > data.length) return null;
    const value = new TextDecoder().decode(data.slice(offset + 4, end)).replaceAll("\0", "");
    offset = end;
    return value.trim();
  };
  const name = text();
  const symbol = text();
  return name === null || symbol === null || (name === "" && symbol === "")
    ? null
    : { name, symbol };
}

// Names for several mints at once; a mint without metadata is left out.
export async function fetchTokenLabels(
  rpc: LiveRpc,
  mints: readonly Address[],
  config?: ReadConfig,
): Promise<ReadonlyMap<Address, TokenLabel>> {
  const accounts = await inBatches(
    await Promise.all(mints.map((mint) => getMetadataAddress(mint))),
    (batch) => fetchEncodedAccounts(rpc, batch, config),
  );
  const labels = new Map<Address, TokenLabel>();
  accounts.forEach((account, index) => {
    if (!account.exists || account.programAddress !== METADATA_PROGRAM_ADDRESS) return;
    const label = decodeTokenLabel(account.data, mints[index]!);
    if (label) labels.set(mints[index]!, label);
  });
  return labels;
}

export async function fetchCollateral(
  rpc: LiveRpc,
  owner: Address,
  mint: Address,
  config?: ReadConfig,
): Promise<LiveCollateral> {
  const account = await fetchMint(rpc, mint, config);
  const tokenProgram = account.programAddress;
  if (tokenProgram !== TOKEN_PROGRAM_ADDRESS && tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error("that address is not a token mint");
  }
  const [[configAddress], [ata]] = await Promise.all([
    getCollateralAddress(mint),
    findAssociatedTokenPda({ owner, tokenProgram, mint }),
  ]);
  const [registration, token] = await Promise.all([
    generatedClient.fetchMaybeCollateralConfig(rpc, configAddress, config),
    fetchMaybeToken(rpc, ata, config),
  ]);
  const { mintAuthority, freezeAuthority, decimals } = account.data;
  return {
    mint,
    tokenProgram,
    issuerControlled: isSome(freezeAuthority),
    decimals,
    registered: registration.exists,
    free: token.exists ? token.data.amount : 0n,
    mintable: isSome(mintAuthority) && mintAuthority.value === owner,
    label: (await fetchTokenLabels(rpc, [mint], config)).get(mint) ?? null,
  };
}

export async function fetchConditions(
  rpc: LiveRpc,
  conditionIds: readonly ReadonlyUint8Array[],
  config?: ReadConfig,
): Promise<ReadonlyMap<string, ChainCondition>> {
  const unique = [...new Map(conditionIds.map((id) => [toHex(id), id])).values()];
  const addresses = await Promise.all(unique.map(async (id) => (await getConditionAddress(id))[0]));
  const accounts = await inBatches(addresses, (batch) =>
    generatedClient.fetchAllMaybeCondition(rpc, batch, config),
  );
  const conditions = new Map<string, ChainCondition>();
  for (const account of accounts) {
    if (!account.exists) continue;
    const { conditionId, questionId, resolver, outcomeCount, status, payoutNumerators } =
      account.data;
    conditions.set(toHex(conditionId), {
      conditionId: Uint8Array.from(conditionId),
      questionId: Uint8Array.from(questionId),
      resolver,
      outcomeCount,
      payouts: status === ConditionStatus.Resolved ? payoutNumerators : null,
    });
  }
  return conditions;
}

// The owner's Token-2022 accounts whose mint is a position's canonical wrapper, by position ID.
// It starts from the tokens, so a wrapped position received from someone else is found too.
async function fetchWrapped(
  rpc: LiveRpc,
  owner: Address,
  config?: ReadConfig,
): Promise<
  ReadonlyMap<string, Readonly<{ positionId: Uint8Array; mint: Address; amount: bigint }>>
> {
  const accounts = await rpc
    .getTokenAccountsByOwner(
      owner,
      { programId: TOKEN_2022_PROGRAM_ADDRESS },
      { encoding: "jsonParsed", ...config },
    )
    .send();
  const amounts = new Map<Address, bigint>();
  for (const { account } of accounts.value) {
    const { mint, tokenAmount } = account.data.parsed.info;
    amounts.set(mint, (amounts.get(mint) ?? 0n) + BigInt(tokenAmount.amount));
  }

  // A wrapper mint's authority is its wrapper config, which names the position.
  const mints = await inBatches([...amounts.keys()], (batch) =>
    fetchAllMaybeMint(rpc, batch, config),
  );
  const candidates = mints.flatMap((mint) =>
    mint.exists && isSome(mint.data.mintAuthority)
      ? [{ mint: mint.address, wrapper: mint.data.mintAuthority.value }]
      : [],
  );
  // Most Token-2022 mints in a wallet are not wrappers, and their authority is any kind of
  // account, so each is checked before it is decoded.
  const wrappers = await inBatches(
    candidates.map((candidate) => candidate.wrapper),
    (batch) => fetchEncodedAccounts(rpc, batch, config),
  );
  const wrapperDecoder = generatedClient.getWrapperConfigDecoder();
  const wrapped = new Map<string, { positionId: Uint8Array; mint: Address; amount: bigint }>();
  for (let index = 0; index < candidates.length; index += 1) {
    const wrapper = wrappers[index]!;
    const { mint } = candidates[index]!;
    if (
      !wrapper.exists ||
      wrapper.programAddress !== CC_TOKEN_PROGRAM_ADDRESS ||
      wrapper.data.length !== wrapperDecoder.fixedSize
    ) {
      continue;
    }
    const positionId = Uint8Array.from(wrapperDecoder.decode(wrapper.data).positionId);
    const [[wrapperAddress], [canonicalMint]] = await Promise.all([
      getWrapperAddress(positionId),
      getWrapperMintAddress(positionId),
    ]);
    if (wrapper.address !== wrapperAddress || canonicalMint !== mint) continue;
    wrapped.set(toHex(positionId), { positionId, mint, amount: amounts.get(mint)! });
  }
  return wrapped;
}

type Held = Readonly<{
  collateralMint: Address;
  collectionId: ReadonlyUint8Array;
  amount: bigint;
  wrapped: bigint;
  wrapperMint: Address | null;
}>;

// Everything the owner has a balance account or wrapper tokens for, whatever its collateral.
// Balances come from one query to the program. Wrapper tokens take a scan of the wallet, and
// when that fails the balances are still returned, with `wrappedChecked` false.
async function fetchHeld(
  rpc: LiveRpc,
  owner: Address,
  config?: ReadConfig,
): Promise<Readonly<{ held: readonly Held[]; wrappedChecked: boolean }>> {
  const discriminator = getBase58Decoder().decode(
    generatedClient.getPositionBalanceDiscriminatorBytes(),
  ) as Base58EncodedBytes;
  const [found, scanned] = await Promise.all([
    rpc
      .getProgramAccounts(CC_TOKEN_PROGRAM_ADDRESS, {
        encoding: "base64",
        ...config,
        filters: [
          { dataSize: BALANCE_SIZE },
          { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
          {
            memcmp: {
              offset: BALANCE_OWNER_OFFSET,
              bytes: owner as string as Base58EncodedBytes,
              encoding: "base58",
            },
          },
        ],
      })
      .send(),
    fetchWrapped(rpc, owner, config).catch((error: unknown) => {
      // A node that is behind has to be asked again, for the balances as much as the tokens.
      if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED)) {
        throw error;
      }
      return null;
    }),
  ]);
  const wrapped: NonNullable<typeof scanned> = scanned ?? new Map();
  const balanceDecoder = generatedClient.getPositionBalanceDecoder();
  const native = new Map<string, Readonly<{ positionId: ReadonlyUint8Array; amount: bigint }>>();
  for (const { account } of found) {
    const balance = balanceDecoder.decode(getBase64Encoder().encode(account.data[0]));
    native.set(toHex(balance.positionId), balance);
  }

  const positionIds = [
    ...new Map(
      [...native.values(), ...wrapped.values()].map(({ positionId }) => [
        toHex(positionId),
        positionId,
      ]),
    ).values(),
  ];
  const definitions = await inBatches(
    await Promise.all(positionIds.map(async (id) => (await getPositionAddress(id))[0])),
    (batch) => generatedClient.fetchAllMaybePositionDefinition(rpc, batch, config),
  );
  const held = positionIds.flatMap((positionId, index) => {
    const definition = definitions[index]!;
    const key = toHex(positionId);
    return definition.exists
      ? [
          {
            collateralMint: definition.data.collateralMint,
            collectionId: definition.data.collectionId,
            amount: native.get(key)?.amount ?? 0n,
            wrapped: wrapped.get(key)?.amount ?? 0n,
            wrapperMint: wrapped.get(key)?.mint ?? null,
          },
        ]
      : [];
  });
  return { held, wrappedChecked: scanned !== null };
}

// The collateral tokens the owner holds positions of, most positions first. This is how a
// wallet that was only ever sent positions finds out what it has.
export async function fetchHeldCollaterals(
  rpc: LiveRpc,
  owner: Address,
): Promise<
  Readonly<{
    collaterals: readonly Readonly<{
      mint: Address;
      positions: number;
      label: TokenLabel | null;
    }>[];
    // False when the wallet could not be searched for wrapped positions.
    wrappedChecked: boolean;
  }>
> {
  const counts = new Map<Address, number>();
  const { held, wrappedChecked } = await fetchHeld(rpc, owner);
  for (const position of held) {
    if (position.amount === 0n && position.wrapped === 0n) continue;
    counts.set(position.collateralMint, (counts.get(position.collateralMint) ?? 0) + 1);
  }
  const labels = await fetchTokenLabels(rpc, [...counts.keys()]);
  const collaterals = [...counts]
    .map(([mint, positions]) => ({ mint, positions, label: labels.get(mint) ?? null }))
    .sort((left, right) => right.positions - left.positions);
  return { collaterals, wrappedChecked };
}

// The wording of a question, read from the memo of the transaction that prepared it and
// checked against the question ID. Null when no memo was published or none matches.
export async function recoverQuestion(
  rpc: LiveRpc,
  condition: ChainCondition,
): Promise<StoredQuestion | null> {
  const [address] = await getConditionAddress(condition.conditionId);
  let before: Signature | undefined;
  // Newest first, so the preparing transaction is on the last page. Busy questions are capped.
  for (let page = 0; page < 5; page += 1) {
    const signatures = await rpc
      .getSignaturesForAddress(address, { limit: 1000, ...(before ? { before } : {}) })
      .send();
    for (const { memo } of signatures) {
      const question = memo === null ? null : questionFromMemo(memo, condition);
      if (question) return question;
    }
    if (signatures.length < 1000) break;
    before = signatures[signatures.length - 1]!.signature;
  }
  return null;
}

// Every position of `mint` the owner holds, rebuilt from the registered collections.
export async function fetchPositions(
  rpc: LiveRpc,
  owner: Address,
  mint: Address,
  config?: ReadConfig,
): Promise<
  Readonly<{
    positions: readonly LivePosition[];
    conditions: ReadonlyMap<string, ChainCondition>;
    // False when the wallet could not be searched for wrapped positions.
    wrappedChecked: boolean;
  }>
> {
  const all = await fetchHeld(rpc, owner, config);
  const held = all.held.filter((position) => position.collateralMint === mint);

  // Walk each collection up to the root, one batch of parents at a time.
  type Step = Readonly<{
    parent: ReadonlyUint8Array;
    conditionId: ReadonlyUint8Array;
    indexSet: IndexSetWords;
  }>;
  const steps = new Map<string, Step>();
  let pending = held.map((position) => position.collectionId);
  while (pending.length > 0) {
    const wanted = [...new Map(pending.map((id) => [toHex(id), id])).values()].filter(
      (id) => !steps.has(toHex(id)) && toHex(id) !== COLLATERAL_KEY,
    );
    const accounts = await inBatches(
      await Promise.all(wanted.map(async (id) => (await getCollectionAddress(id))[0])),
      (batch) => generatedClient.fetchAllMaybeCollectionDefinition(rpc, batch, config),
    );
    pending = [];
    for (const account of accounts) {
      if (!account.exists) continue;
      const { collectionId, parentCollectionId, conditionId, indexSet } = account.data;
      const [first, second, third, fourth] = indexSet.words;
      steps.set(toHex(collectionId), {
        parent: parentCollectionId,
        conditionId,
        indexSet: [first!, second!, third!, fourth!],
      });
      pending.push(parentCollectionId);
    }
  }

  const conditions = await fetchConditions(
    rpc,
    [...steps.values()].map((step) => step.conditionId),
    config,
  );
  const positions = held.flatMap(({ collectionId, collateralMint: _, ...balance }) => {
    const factors: ConditionClause[] = [];
    let key = toHex(collectionId);
    while (key !== COLLATERAL_KEY) {
      const step = steps.get(key);
      const condition = step && conditions.get(toHex(step.conditionId));
      if (!step || !condition) return [];
      factors.unshift({
        conditionId: condition.conditionId,
        outcomeCount: condition.outcomeCount,
        indexSet: step.indexSet,
      });
      key = toHex(step.parent);
    }
    // The identifier is recomputed from the factors, so a wrong chain cannot be shown.
    return holdingKey(factors) === toHex(collectionId) ? [{ factors, ...balance }] : [];
  });
  return { positions, conditions, wrappedChecked: all.wrappedChecked };
}

function isStrictSubset(inner: IndexSetWords, outer: IndexSetWords): boolean {
  return (
    inner.every((word, index) => (word & ~outer[index]!) === 0n) &&
    inner.some((word, index) => word !== outer[index])
  );
}

function size(indexSet: IndexSetWords): number {
  return indexSet.reduce((count, word) => count + word.toString(2).replaceAll("0", "").length, 0);
}

// The chain keeps balances, not the splits that produced them. Each position is drawn under
// the narrowest held position it could have been cut from, else under the position without
// its last question, else under the collateral.
export function ledgerFromPositions(
  free: bigint,
  positions: readonly (Pick<LivePosition, "factors" | "amount"> & { wrapped?: bigint })[],
): Ledger {
  const all = positions.map((position) => ({
    factors: position.factors,
    amount: position.amount,
    wrapped: position.wrapped ?? 0n,
    key: holdingKey(position.factors),
  }));
  const sourceOf = (node: (typeof all)[number]): string => {
    let source: string | null = null;
    let sourceSize = Infinity;
    // Factors have no order on-chain, so any of them may be the one that was narrowed.
    node.factors.forEach((narrowed, narrowedIndex) => {
      const restKey = holdingKey(node.factors.filter((_, index) => index !== narrowedIndex));
      for (const other of all) {
        if (other.key === node.key || other.factors.length !== node.factors.length) continue;
        for (let index = 0; index < other.factors.length; index += 1) {
          const factor = other.factors[index]!;
          if (
            toHex(factor.conditionId) === toHex(narrowed.conditionId) &&
            isStrictSubset(narrowed.indexSet, factor.indexSet) &&
            size(factor.indexSet) < sourceSize &&
            holdingKey(other.factors.filter((_, position) => position !== index)) === restKey
          ) {
            source = other.key;
            sourceSize = size(factor.indexSet);
          }
        }
      }
    });
    if (source !== null) return source;
    const restKey = holdingKey(node.factors.slice(0, -1));
    return all.some((other) => other.key === restKey) ? restKey : COLLATERAL_KEY;
  };

  let nodes: readonly (PositionNode & { amount: bigint; wrapped: bigint })[] = all;
  let edges: readonly Edge[] = all.map((node) => ({ from: sourceOf(node), to: node.key }));
  // An emptied balance account with nothing wrapped and nothing under it is only clutter.
  for (;;) {
    const spent = nodes.find(
      (node) =>
        node.amount === 0n && node.wrapped === 0n && !edges.some((edge) => edge.from === node.key),
    );
    if (!spent) break;
    nodes = nodes.filter((node) => node !== spent);
    edges = edges.filter((edge) => edge.to !== spent.key);
  }

  const holdings: Holding[] = nodes
    .filter((node) => node.amount > 0n)
    .map(({ key, factors, amount }) => ({ key, factors, amount }));
  return {
    portfolio: { collateral: free, holdings },
    nodes: nodes.map(({ key, factors }) => ({ key, factors })),
    edges,
  };
}
