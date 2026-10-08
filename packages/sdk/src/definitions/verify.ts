import type { Account, FetchAccountConfig, ReadonlyUint8Array } from "@solana/kit";

import {
  fetchMaybeCollectionDefinition,
  fetchMaybeCondition,
  getCollectionDefinitionDiscriminatorBytes,
  getConditionDiscriminatorBytes,
  CC_TOKEN_PROGRAM_ADDRESS,
  ConditionStatus,
  type CollectionDefinition,
  type Condition,
} from "../generated/index.ts";
import {
  deriveCollectionId,
  deriveConditionId,
  getCollectionAddress,
  getConditionAddress,
  ROOT_COLLECTION_ID,
  type IndexSetWords,
} from "../identity.ts";
import { planExplicitProduct, type ConditionClause } from "../composition/plan.ts";
import { validateProperIndexSet } from "../composition/index-set.ts";

const STATE_VERSION = 1;
const MAX_U64 = (1n << 64n) - 1n;
const DEFAULT_MAX_COLLECTION_DEPTH = 256;

export type DefinitionVerificationErrorCode =
  | "cycle"
  | "depth_limit"
  | "invalid_discriminator"
  | "invalid_identity"
  | "invalid_owner"
  | "invalid_payouts"
  | "invalid_pda"
  | "invalid_version"
  | "invalid_witness"
  | "missing_definition";

export class DefinitionVerificationError extends Error {
  readonly code: DefinitionVerificationErrorCode;

  constructor(code: DefinitionVerificationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DefinitionVerificationError";
    this.code = code;
  }
}

export type VerifiedCollectionWitness = Readonly<{
  collection: Account<CollectionDefinition>;
  condition: Account<Condition>;
}>;

export type VerifiedCollectionFactor = ConditionClause &
  Readonly<{
    condition: Account<Condition>;
  }>;

export type VerifiedCollection = Readonly<{
  collectionId: ReadonlyUint8Array;
  constructionPath: readonly VerifiedCollectionWitness[];
  factors: readonly VerifiedCollectionFactor[];
}>;

export type VerifiedCollectionFetchConfig = FetchAccountConfig &
  Readonly<{
    maxDepth?: number;
  }>;

type DefinitionRpc = Parameters<typeof fetchMaybeCondition>[0];

export async function verifyConditionAccount(
  account: Account<Condition>,
): Promise<Account<Condition>> {
  verifyProgramAccount(account, "condition");
  requireBytes(
    account.data.discriminator,
    getConditionDiscriminatorBytes(),
    "invalid_discriminator",
    "condition discriminator does not match",
  );
  if (account.data.version !== STATE_VERSION) {
    throw new DefinitionVerificationError(
      "invalid_version",
      `unsupported condition version ${account.data.version}`,
    );
  }

  let derivedConditionId: ReadonlyUint8Array;
  try {
    derivedConditionId = deriveConditionId(
      account.data.resolver,
      account.data.questionId,
      account.data.outcomeCount,
    );
  } catch (cause) {
    throw new DefinitionVerificationError("invalid_identity", "invalid condition definition", {
      cause,
    });
  }
  requireBytes(
    account.data.conditionId,
    derivedConditionId,
    "invalid_identity",
    "condition ID does not match its definition",
  );

  const [conditionAddress, bump] = await getConditionAddress(account.data.conditionId);
  if (account.address !== conditionAddress || account.data.bump !== bump) {
    throw new DefinitionVerificationError(
      "invalid_pda",
      "condition account is not its canonical PDA",
    );
  }

  verifyConditionPayouts(account.data);
  return account;
}

export async function verifyCollectionAccount(
  account: Account<CollectionDefinition>,
  condition: Account<Condition>,
): Promise<Account<CollectionDefinition>> {
  verifyProgramAccount(account, "collection");
  requireBytes(
    account.data.discriminator,
    getCollectionDefinitionDiscriminatorBytes(),
    "invalid_discriminator",
    "collection discriminator does not match",
  );
  if (account.data.version !== STATE_VERSION) {
    throw new DefinitionVerificationError(
      "invalid_version",
      `unsupported collection version ${account.data.version}`,
    );
  }

  await verifyConditionAccount(condition);
  requireBytes(
    account.data.conditionId,
    condition.data.conditionId,
    "invalid_witness",
    "collection condition does not match its witness",
  );

  const indexSet = readIndexSet(account.data.indexSet.words);
  try {
    validateProperIndexSet(condition.data.outcomeCount, indexSet);
  } catch (cause) {
    throw new DefinitionVerificationError("invalid_witness", "invalid collection subset", {
      cause,
    });
  }

  let derivedCollectionId: ReadonlyUint8Array;
  try {
    derivedCollectionId = deriveCollectionId(
      account.data.parentCollectionId,
      account.data.conditionId,
      indexSet,
    ).collectionId;
  } catch (cause) {
    throw new DefinitionVerificationError("invalid_witness", "invalid collection construction", {
      cause,
    });
  }
  requireBytes(
    account.data.collectionId,
    derivedCollectionId,
    "invalid_witness",
    "collection ID does not match its construction",
  );

  const [collectionAddress, bump] = await getCollectionAddress(account.data.collectionId);
  if (account.address !== collectionAddress || account.data.bump !== bump) {
    throw new DefinitionVerificationError(
      "invalid_pda",
      "collection account is not its canonical PDA",
    );
  }
  return account;
}

export async function fetchVerifiedCondition(
  rpc: DefinitionRpc,
  conditionId: ReadonlyUint8Array,
  config?: FetchAccountConfig,
): Promise<Account<Condition>> {
  const [conditionAddress] = await getConditionAddress(conditionId);
  const condition = await fetchMaybeCondition(rpc, conditionAddress, config);
  if (!condition.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `condition ${conditionAddress} does not exist`,
    );
  }
  requireBytes(
    condition.data.conditionId,
    conditionId,
    "invalid_identity",
    "fetched condition does not match the requested ID",
  );
  return verifyConditionAccount(condition);
}

export async function fetchVerifiedCollection(
  rpc: DefinitionRpc,
  collectionId: ReadonlyUint8Array,
  config?: VerifiedCollectionFetchConfig,
): Promise<VerifiedCollection> {
  const { maxDepth = DEFAULT_MAX_COLLECTION_DEPTH, ...accountConfig } = config ?? {};
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError("maxDepth must be a positive integer");
  }
  if (bytesEqual(collectionId, ROOT_COLLECTION_ID)) {
    return {
      collectionId: Uint8Array.from(ROOT_COLLECTION_ID),
      constructionPath: [],
      factors: [],
    };
  }

  const conditionCache = new Map<string, Account<Condition>>();
  const visitedCollections = new Set<string>();
  const leafToRoot: VerifiedCollectionWitness[] = [];
  let nextCollectionId = Uint8Array.from(collectionId);

  while (!bytesEqual(nextCollectionId, ROOT_COLLECTION_ID)) {
    const collectionKey = identifierKey(nextCollectionId);
    if (visitedCollections.has(collectionKey)) {
      throw new DefinitionVerificationError("cycle", "collection witness path contains a cycle");
    }
    if (leafToRoot.length >= maxDepth) {
      throw new DefinitionVerificationError(
        "depth_limit",
        `collection witness path exceeds ${maxDepth} factors`,
      );
    }
    visitedCollections.add(collectionKey);

    const [collectionAddress] = await getCollectionAddress(nextCollectionId);
    const collection = await fetchMaybeCollectionDefinition(rpc, collectionAddress, accountConfig);
    if (!collection.exists) {
      throw new DefinitionVerificationError(
        "missing_definition",
        `collection ${collectionAddress} does not exist`,
      );
    }
    requireBytes(
      collection.data.collectionId,
      nextCollectionId,
      "invalid_identity",
      "fetched collection does not match the requested ID",
    );

    const conditionKey = identifierKey(collection.data.conditionId);
    let condition = conditionCache.get(conditionKey);
    if (!condition) {
      condition = await fetchVerifiedCondition(rpc, collection.data.conditionId, accountConfig);
      conditionCache.set(conditionKey, condition);
    }
    await verifyCollectionAccount(collection, condition);
    leafToRoot.push({ collection, condition });
    nextCollectionId = Uint8Array.from(collection.data.parentCollectionId);
  }

  return buildVerifiedCollection(collectionId, leafToRoot);
}

function buildVerifiedCollection(
  collectionId: ReadonlyUint8Array,
  leafToRoot: readonly VerifiedCollectionWitness[],
): VerifiedCollection {
  const constructionPath = [...leafToRoot].reverse();
  const conditions = new Map<string, Account<Condition>>();
  const clauses = constructionPath.map(({ collection, condition }) => {
    conditions.set(identifierKey(condition.data.conditionId), condition);
    return {
      conditionId: Uint8Array.from(collection.data.conditionId),
      outcomeCount: condition.data.outcomeCount,
      indexSet: readIndexSet(collection.data.indexSet.words),
    } satisfies ConditionClause;
  });
  const canonical = planExplicitProduct(clauses);
  requireBytes(
    canonical.collectionId,
    collectionId,
    "invalid_witness",
    "collection path does not reconstruct the requested ID",
  );

  const factors = canonical.factors.map((factor) => ({
    ...factor,
    condition: conditions.get(identifierKey(factor.conditionId))!,
  }));
  return {
    collectionId: Uint8Array.from(collectionId),
    constructionPath,
    factors,
  };
}

function verifyProgramAccount(
  account: Account<Condition> | Account<CollectionDefinition>,
  name: string,
): void {
  if (account.programAddress !== CC_TOKEN_PROGRAM_ADDRESS || account.executable) {
    throw new DefinitionVerificationError(
      "invalid_owner",
      `${name} account is not owned by the cc-token program`,
    );
  }
}

function verifyConditionPayouts(condition: Condition): void {
  if (condition.payoutNumerators.length !== condition.outcomeCount) {
    throw new DefinitionVerificationError(
      "invalid_payouts",
      "condition payout count does not match its outcome count",
    );
  }

  let denominator = 0n;
  for (const numerator of condition.payoutNumerators) {
    if (numerator < 0n || numerator > MAX_U64) {
      throw new DefinitionVerificationError(
        "invalid_payouts",
        "condition payout numerator is out of range",
      );
    }
    denominator += numerator;
  }

  if (condition.status === ConditionStatus.Unresolved) {
    if (condition.payoutDenominator !== 0n || denominator !== 0n) {
      throw new DefinitionVerificationError(
        "invalid_payouts",
        "unresolved condition contains active payouts",
      );
    }
    return;
  }
  if (condition.status !== ConditionStatus.Resolved) {
    throw new DefinitionVerificationError("invalid_payouts", "condition status is invalid");
  }
  if (denominator === 0n || condition.payoutDenominator !== denominator) {
    throw new DefinitionVerificationError(
      "invalid_payouts",
      "resolved condition payout denominator is invalid",
    );
  }
}

function readIndexSet(words: readonly bigint[]): IndexSetWords {
  if (words.length !== 4) {
    throw new DefinitionVerificationError(
      "invalid_witness",
      "collection index set must contain four words",
    );
  }
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

function requireBytes(
  actual: ReadonlyUint8Array,
  expected: ReadonlyUint8Array,
  code: DefinitionVerificationErrorCode,
  message: string,
): void {
  if (!bytesEqual(actual, expected)) throw new DefinitionVerificationError(code, message);
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function identifierKey(identifier: ReadonlyUint8Array): string {
  return Array.from(identifier, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
