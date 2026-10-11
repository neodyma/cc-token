import {
  decodeCollectionDefinition,
  decodeCondition,
  decodePositionDefinition,
  decodeScenarioDefinition,
  CC_TOKEN_PROGRAM_ADDRESS,
  ConditionStatus,
  fetchMaybeScenarioDefinition,
  getRegisterCollectionInstruction,
  getRegisterScenarioInstruction,
  getScenarioDefinitionDiscriminatorBytes,
  getUpdateScenarioNameInstruction,
  type Condition,
  type PositionDefinition,
  type ScenarioDefinition,
} from "../generated/index.ts";
import {
  derivePositionId,
  getCollectionAddress,
  getConditionAddress,
  getPositionAddress,
  getScenarioAddress,
  ROOT_COLLECTION_ID,
} from "../identity.ts";
import {
  planExplicitProduct,
  planLogicalConjunction,
  type ConditionClause,
} from "../composition/plan.ts";
import {
  fetchVerifiedPosition,
  fetchVerifiedPositionDefinition,
  getRegisterPositionForCollectionInstruction,
  verifyPositionAccount,
  verifyPositionDefinitionAccount,
  type VerifiedPosition,
} from "./positions.ts";
import {
  buildVerifiedCollection,
  DefinitionVerificationError,
  verifyCollectionAccount,
  verifyConditionAccount,
  type VerifiedCollection,
  type VerifiedCollectionWitness,
} from "./verify.ts";
import { fetchVerifiedCollateral } from "./collateral.ts";
import {
  fetchEncodedAccounts,
  getBase58Decoder,
  type Account,
  type Address,
  type Base58EncodedBytes,
  type FetchAccountConfig,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type Instruction,
  type ReadonlyUint8Array,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";

const STATE_VERSION = 1;
export const MAX_SCENARIO_NAME_BYTES = 64;
export const SCENARIO_DEFINITION_SPACE = 150n;
const MAX_BATCH_SIZE = 100;

type ScenarioRpc = Parameters<typeof fetchMaybeScenarioDefinition>[0] &
  Rpc<GetMultipleAccountsApi & GetProgramAccountsApi>;

export type ScenarioState = "active" | "partially_resolved" | "resolved";

export type VerifiedScenario = Readonly<{
  definition: Account<ScenarioDefinition>;
  anchor: VerifiedPosition;
  state: ScenarioState;
  uniqueConditionCount: number;
  factorCount: number;
}>;

export type ScenarioDiscoveryFailure = Readonly<{
  address: Address;
  error: Error;
}>;

export type ScenarioDiscovery = Readonly<{
  scenarios: readonly VerifiedScenario[];
  failures: readonly ScenarioDiscoveryFailure[];
}>;

export type ScenarioParticipation = "exact" | "compatible" | "unrelated";

export function validateScenarioName(name: string): void {
  const size = new TextEncoder().encode(name).length;
  if (size < 1 || size > MAX_SCENARIO_NAME_BYTES || name.trim() !== name || /\p{Cc}/u.test(name)) {
    throw new RangeError(
      "scenario name must be 1 to 64 UTF-8 bytes without surrounding whitespace or control characters",
    );
  }
}

export async function getRegisterScenarioDefinitionInstruction(input: {
  payer: TransactionSigner;
  creator: TransactionSigner;
  anchorPositionId: ReadonlyUint8Array;
  name: string;
}) {
  validateScenarioName(input.name);
  const [[anchorPosition], [scenario]] = await Promise.all([
    getPositionAddress(input.anchorPositionId),
    getScenarioAddress(input.creator.address, input.anchorPositionId),
  ]);
  return getRegisterScenarioInstruction({
    payer: input.payer,
    creator: input.creator,
    anchorPosition,
    scenario,
    anchorPositionId: input.anchorPositionId,
    name: input.name,
  });
}

export async function getUpdateScenarioDefinitionNameInstruction(input: {
  creator: TransactionSigner;
  anchorPositionId: ReadonlyUint8Array;
  name: string;
}) {
  validateScenarioName(input.name);
  const [scenario] = await getScenarioAddress(input.creator.address, input.anchorPositionId);
  return getUpdateScenarioNameInstruction({ creator: input.creator, scenario, name: input.name });
}

export async function verifyScenarioDefinitionAccount(
  account: Account<ScenarioDefinition>,
): Promise<Account<ScenarioDefinition>> {
  if (account.programAddress !== CC_TOKEN_PROGRAM_ADDRESS || account.executable) {
    throw new DefinitionVerificationError(
      "invalid_owner",
      "scenario definition is not owned by the cc-token program",
    );
  }
  requireBytes(
    account.data.discriminator,
    getScenarioDefinitionDiscriminatorBytes(),
    "invalid_discriminator",
    "scenario discriminator does not match",
  );
  if (account.data.version !== STATE_VERSION) {
    throw new DefinitionVerificationError(
      "invalid_version",
      `unsupported scenario version ${account.data.version}`,
    );
  }
  try {
    validateScenarioName(account.data.name);
  } catch (cause) {
    throw new DefinitionVerificationError("invalid_identity", "scenario name is invalid", {
      cause,
    });
  }
  if (account.data.anchorPositionId.length !== 32) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "scenario anchor position ID must contain 32 bytes",
    );
  }
  const [address, bump] = await getScenarioAddress(
    account.data.creator,
    account.data.anchorPositionId,
  );
  if (account.address !== address || account.data.bump !== bump) {
    throw new DefinitionVerificationError("invalid_pda", "scenario is not its canonical PDA");
  }
  return account;
}

export async function fetchVerifiedScenarioDefinition(
  rpc: ScenarioRpc,
  address: Address,
  config?: FetchAccountConfig,
): Promise<Account<ScenarioDefinition>> {
  const account = await fetchMaybeScenarioDefinition(rpc, address, config);
  if (!account.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `scenario ${address} does not exist`,
    );
  }
  return verifyScenarioDefinitionAccount(account);
}

export async function fetchVerifiedScenario(
  rpc: ScenarioRpc,
  address: Address,
  config?: FetchAccountConfig,
): Promise<VerifiedScenario> {
  const definition = await fetchVerifiedScenarioDefinition(rpc, address, config);
  const position = await fetchVerifiedPositionDefinition(
    rpc,
    definition.data.anchorPositionId,
    config,
  );
  const anchor = await fetchVerifiedPosition(
    rpc,
    position.data.collateralMint,
    position.data.collectionId,
    config,
  );
  requireBytes(
    anchor.position.data.positionId,
    definition.data.anchorPositionId,
    "invalid_witness",
    "scenario anchor does not match its position",
  );
  return buildScenario(definition, anchor);
}

export async function fetchAllVerifiedScenarios(
  rpc: ScenarioRpc,
  config?: FetchAccountConfig,
): Promise<ScenarioDiscovery> {
  const discriminator = getBase58Decoder().decode(
    getScenarioDefinitionDiscriminatorBytes(),
  ) as Base58EncodedBytes;
  const found = await rpc
    .getProgramAccounts(CC_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      commitment: config?.commitment ?? "confirmed",
      filters: [
        { dataSize: SCENARIO_DEFINITION_SPACE },
        { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
      ],
    })
    .send();
  const addresses = found.map(({ pubkey }) => pubkey);
  const failures: ScenarioDiscoveryFailure[] = [];
  const definitions: Account<ScenarioDefinition>[] = [];
  for (const account of await fetchEncodedInChunks(rpc, addresses, config)) {
    if (!account.exists) continue;
    try {
      definitions.push(await verifyScenarioDefinitionAccount(decodeScenarioDefinition(account)));
    } catch (cause) {
      failures.push({ address: account.address, error: toError(cause) });
    }
  }

  const anchorIds = uniqueBytes(definitions.map((item) => item.data.anchorPositionId));
  const anchorAddresses = await Promise.all(
    anchorIds.map(async (positionId) => (await getPositionAddress(positionId))[0]),
  );
  const anchors = new Map<string, Account<PositionDefinition>>();
  const anchorAccounts = await fetchEncodedInChunks(rpc, anchorAddresses, config);
  for (let index = 0; index < anchorAccounts.length; index += 1) {
    const encoded = anchorAccounts[index]!;
    if (!encoded.exists) continue;
    try {
      const anchor = await verifyPositionDefinitionAccount(decodePositionDefinition(encoded));
      anchors.set(bytesKey(anchorIds[index]!), anchor);
    } catch {
      // Report the error against each dependent scenario below.
    }
  }

  const collections = await fetchCollectionGraph(
    rpc,
    [...anchors.values()].map((anchor) => anchor.data.collectionId),
    config,
  );
  const collateral = new Map<Address, Awaited<ReturnType<typeof fetchVerifiedCollateral>>>();
  await Promise.all(
    [...new Set([...anchors.values()].map((anchor) => anchor.data.collateralMint))].map(
      async (mint) => {
        try {
          collateral.set(mint, await fetchVerifiedCollateral(rpc, mint, config));
        } catch {
          // Report the error against each dependent scenario below.
        }
      },
    ),
  );

  const scenarios: VerifiedScenario[] = [];
  for (const definition of definitions) {
    try {
      const position = anchors.get(bytesKey(definition.data.anchorPositionId));
      if (!position) throw new Error("scenario anchor position is missing or invalid");
      const verifiedCollateral = collateral.get(position.data.collateralMint);
      if (!verifiedCollateral) throw new Error("scenario collateral is missing or invalid");
      const verifiedCollection = collectionFor(position.data.collectionId, collections);
      await verifyPositionAccount(position, verifiedCollateral, verifiedCollection);
      scenarios.push(
        buildScenario(definition, {
          position,
          collateral: verifiedCollateral,
          collection: verifiedCollection,
        }),
      );
    } catch (cause) {
      failures.push({ address: definition.address, error: toError(cause) });
    }
  }
  return { scenarios, failures };
}

export function classifyScenarioParticipation(
  scenario: Pick<VerifiedScenario, "anchor">,
  position: Readonly<{
    collateralMint: Address;
    factors: readonly Pick<ConditionClause, "conditionId">[];
  }>,
): ScenarioParticipation {
  if (position.collateralMint !== scenario.anchor.position.data.collateralMint) return "unrelated";
  const scenarioBasis = conditionMultiset(scenario.anchor.collection.factors);
  const positionBasis = conditionMultiset(position.factors);
  if (positionBasis.size === 0) return "unrelated";
  for (const [conditionId, count] of positionBasis) {
    if ((scenarioBasis.get(conditionId) ?? 0) < count) return "unrelated";
  }
  if (
    scenarioBasis.size === positionBasis.size &&
    [...scenarioBasis].every(([conditionId, count]) => positionBasis.get(conditionId) === count)
  ) {
    return "exact";
  }
  return "compatible";
}

export async function planScenarioAnchor(input: {
  payer: TransactionSigner;
  creator: TransactionSigner;
  collateralMint: Address;
  factors: readonly ConditionClause[];
  mode?: "logical" | "product";
  name: string;
}): Promise<
  Readonly<{
    anchorPositionId: ReadonlyUint8Array;
    collectionId: ReadonlyUint8Array;
    factors: readonly ConditionClause[];
    setupInstructions: readonly Instruction[];
    registerScenarioInstruction: Instruction;
  }>
> {
  validateScenarioName(input.name);
  const composition =
    input.mode === "product"
      ? planExplicitProduct(input.factors)
      : planLogicalConjunction(input.factors);
  if (composition.steps.length === 0) {
    throw new RangeError("a scenario anchor must contain at least one proper condition factor");
  }
  const collections: Instruction[] = [];
  let parentCollection: Address | undefined;
  for (const step of composition.steps) {
    const [[condition], [collection]] = await Promise.all([
      getConditionAddress(step.conditionId),
      getCollectionAddress(step.collectionId),
    ]);
    collections.push(
      getRegisterCollectionInstruction({
        payer: input.payer,
        condition,
        collection,
        parentCollection,
        collectionId: step.collectionId,
        parentCollectionId: step.parentCollectionId,
        conditionId: step.conditionId,
        indexSet: { words: [...step.indexSet] },
      }),
    );
    parentCollection = collection;
  }
  const positionInstruction = await getRegisterPositionForCollectionInstruction({
    payer: input.payer,
    collateralMint: input.collateralMint,
    collectionId: composition.collectionId,
  });
  const anchorPositionId = derivePositionId(input.collateralMint, composition.collectionId);
  const registerScenarioInstruction = await getRegisterScenarioDefinitionInstruction({
    payer: input.payer,
    creator: input.creator,
    anchorPositionId,
    name: input.name,
  });
  return {
    anchorPositionId,
    collectionId: composition.collectionId,
    factors: composition.factors,
    setupInstructions: [...collections, positionInstruction],
    registerScenarioInstruction,
  };
}

type EncodedMaybeAccount = Awaited<ReturnType<typeof fetchEncodedAccounts>>[number];

async function fetchEncodedInChunks(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: readonly Address[],
  config?: FetchAccountConfig,
): Promise<readonly EncodedMaybeAccount[]> {
  const output: EncodedMaybeAccount[] = [];
  for (let offset = 0; offset < addresses.length; offset += MAX_BATCH_SIZE) {
    output.push(
      ...(await fetchEncodedAccounts(
        rpc,
        addresses.slice(offset, offset + MAX_BATCH_SIZE),
        config,
      )),
    );
  }
  return output;
}

async function fetchCollectionGraph(
  rpc: ScenarioRpc,
  leaves: readonly ReadonlyUint8Array[],
  config?: FetchAccountConfig,
): Promise<ReadonlyMap<string, VerifiedCollectionWitness>> {
  const witnesses = new Map<string, VerifiedCollectionWitness>();
  let pending: ReadonlyUint8Array[] = [...uniqueBytes(leaves)];
  let depth = 0;
  while (pending.length > 0) {
    if (depth >= 256) {
      throw new DefinitionVerificationError(
        "depth_limit",
        "scenario collection witness exceeds 256 factors",
      );
    }
    const wanted = pending.filter(
      (collectionId) =>
        !bytesEqual(collectionId, ROOT_COLLECTION_ID) && !witnesses.has(bytesKey(collectionId)),
    );
    if (wanted.length === 0) break;
    const collectionAccounts = await fetchEncodedInChunks(
      rpc,
      await Promise.all(wanted.map(async (id) => (await getCollectionAddress(id))[0])),
      config,
    );
    const decoded = collectionAccounts.flatMap((encoded, index) => {
      if (!encoded.exists) return [];
      try {
        return [{ collection: decodeCollectionDefinition(encoded), id: wanted[index]! }];
      } catch {
        return [];
      }
    });
    const conditionIds = uniqueBytes(decoded.map(({ collection }) => collection.data.conditionId));
    const conditionAccounts = await fetchEncodedInChunks(
      rpc,
      await Promise.all(conditionIds.map(async (id) => (await getConditionAddress(id))[0])),
      config,
    );
    const conditions = new Map<string, Account<Condition>>();
    for (let index = 0; index < conditionAccounts.length; index += 1) {
      const encoded = conditionAccounts[index]!;
      if (!encoded.exists) continue;
      try {
        const condition = await verifyConditionAccount(decodeCondition(encoded));
        conditions.set(bytesKey(conditionIds[index]!), condition);
      } catch {
        // The dependent collection remains invalid.
      }
    }
    pending = [];
    for (const { collection, id } of decoded) {
      const condition = conditions.get(bytesKey(collection.data.conditionId));
      if (!condition || !bytesEqual(collection.data.collectionId, id)) continue;
      try {
        await verifyCollectionAccount(collection, condition);
        witnesses.set(bytesKey(id), { collection, condition });
        pending.push(collection.data.parentCollectionId);
      } catch {
        // The dependent scenario receives a structured failure later.
      }
    }
    depth += 1;
  }
  return witnesses;
}

function collectionFor(
  collectionId: ReadonlyUint8Array,
  witnesses: ReadonlyMap<string, VerifiedCollectionWitness>,
): VerifiedCollection {
  const leafToRoot: VerifiedCollectionWitness[] = [];
  const visited = new Set<string>();
  let next = collectionId;
  while (!bytesEqual(next, ROOT_COLLECTION_ID)) {
    const key = bytesKey(next);
    if (visited.has(key)) {
      throw new DefinitionVerificationError("cycle", "collection witness path contains a cycle");
    }
    if (leafToRoot.length >= 256) {
      throw new DefinitionVerificationError(
        "depth_limit",
        "collection witness path exceeds 256 factors",
      );
    }
    visited.add(key);
    const witness = witnesses.get(key);
    if (!witness) {
      throw new DefinitionVerificationError(
        "missing_definition",
        "scenario collection witness is missing or invalid",
      );
    }
    leafToRoot.push(witness);
    next = witness.collection.data.parentCollectionId;
  }
  return buildVerifiedCollection(collectionId, leafToRoot);
}

function buildScenario(
  definition: Account<ScenarioDefinition>,
  anchor: VerifiedPosition,
): VerifiedScenario {
  const uniqueConditions = new Map<string, Account<Condition>>();
  for (const factor of anchor.collection.factors) {
    uniqueConditions.set(bytesKey(factor.conditionId), factor.condition);
  }
  const resolved = [...uniqueConditions.values()].filter(
    (condition) => condition.data.status === ConditionStatus.Resolved,
  ).length;
  const state: ScenarioState =
    resolved === 0
      ? "active"
      : resolved === uniqueConditions.size
        ? "resolved"
        : "partially_resolved";
  return {
    definition,
    anchor,
    state,
    uniqueConditionCount: uniqueConditions.size,
    factorCount: anchor.collection.factors.length,
  };
}

function conditionMultiset(
  factors: readonly Pick<ConditionClause, "conditionId">[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const factor of factors) {
    const key = bytesKey(factor.conditionId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function uniqueBytes(values: readonly ReadonlyUint8Array[]): readonly ReadonlyUint8Array[] {
  return [...new Map(values.map((value) => [bytesKey(value), value])).values()];
}

function requireBytes(
  actual: ReadonlyUint8Array,
  expected: ReadonlyUint8Array,
  code: DefinitionVerificationError["code"],
  message: string,
): void {
  if (!bytesEqual(actual, expected)) throw new DefinitionVerificationError(code, message);
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function bytesKey(value: ReadonlyUint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
