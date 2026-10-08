import {
  type Account,
  type Address,
  type FetchAccountConfig,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  fetchMaybePositionBalance,
  fetchMaybePositionDefinition,
  getCloseBalanceInstruction,
  getInitializeBalanceInstruction,
  getPositionBalanceDiscriminatorBytes,
  getPositionDefinitionDiscriminatorBytes,
  getRegisterPositionInstruction,
  type PositionBalance,
  type PositionDefinition,
} from "../generated/index.ts";
import {
  derivePositionId,
  getCollateralAddress,
  getCollectionAddress,
  getPositionAddress,
  getPositionBalanceAddress,
} from "../identity.ts";
import { type VerifiedCollateral, fetchVerifiedCollateral } from "./collateral.ts";
import {
  DefinitionVerificationError,
  fetchVerifiedCollection,
  type VerifiedCollection,
} from "./verify.ts";

const STATE_VERSION = 1;

type PositionRpc = Parameters<typeof fetchMaybePositionDefinition>[0];

export type VerifiedPosition = Readonly<{
  position: Account<PositionDefinition>;
  collateral: VerifiedCollateral;
  collection: VerifiedCollection;
}>;

export type VerifiedPositionBalance =
  | Readonly<{
      exists: false;
      address: Address;
      owner: Address;
      position: Account<PositionDefinition>;
    }>
  | Readonly<{
      exists: true;
      account: Account<PositionBalance>;
      owner: Address;
      position: Account<PositionDefinition>;
    }>;

export async function fetchVerifiedPosition(
  rpc: PositionRpc,
  collateralMint: Address,
  collectionId: ReadonlyUint8Array,
  config?: FetchAccountConfig,
): Promise<VerifiedPosition> {
  const positionId = derivePositionId(collateralMint, collectionId);
  const [position, collateral, collection] = await Promise.all([
    fetchVerifiedPositionDefinition(rpc, positionId, config),
    fetchVerifiedCollateral(rpc, collateralMint, config),
    fetchVerifiedCollection(rpc, collectionId, config),
  ]);
  await verifyPositionAccount(position, collateral, collection);
  return { position, collateral, collection };
}

export async function fetchVerifiedPositionDefinition(
  rpc: PositionRpc,
  positionId: ReadonlyUint8Array,
  config?: FetchAccountConfig,
): Promise<Account<PositionDefinition>> {
  const [positionAddress] = await getPositionAddress(positionId);
  const position = await fetchMaybePositionDefinition(rpc, positionAddress, config);
  if (!position.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `position ${positionAddress} does not exist`,
    );
  }
  requireBytes(
    position.data.positionId,
    positionId,
    "invalid_identity",
    "fetched position does not match the requested ID",
  );
  await verifyPositionIdentity(position);
  return position;
}

export async function verifyPositionAccount(
  position: Account<PositionDefinition>,
  collateral: VerifiedCollateral,
  collection: VerifiedCollection,
): Promise<Account<PositionDefinition>> {
  await verifyPositionIdentity(position);
  if (position.data.collateralMint !== collateral.config.data.mint) {
    throw new DefinitionVerificationError(
      "invalid_witness",
      "position collateral does not match its config",
    );
  }
  requireBytes(
    position.data.collectionId,
    collection.collectionId,
    "invalid_witness",
    "position collection does not match its definition",
  );
  return position;
}

export async function fetchVerifiedPositionBalance(
  rpc: PositionRpc,
  owner: Address,
  positionId: ReadonlyUint8Array,
  config?: FetchAccountConfig,
): Promise<VerifiedPositionBalance> {
  const position = await fetchVerifiedPositionDefinition(rpc, positionId, config);
  const [balanceAddress] = await getPositionBalanceAddress(owner, positionId);
  const balance = await fetchMaybePositionBalance(rpc, balanceAddress, config);
  if (!balance.exists) return { exists: false, address: balanceAddress, owner, position };
  await verifyPositionBalanceAccount(balance, owner, position);
  return { exists: true, account: balance, owner, position };
}

export async function verifyPositionBalanceAccount(
  balance: Account<PositionBalance>,
  owner: Address,
  position: Account<PositionDefinition>,
): Promise<Account<PositionBalance>> {
  verifyProgramAccount(balance, "position balance");
  requireBytes(
    balance.data.discriminator,
    getPositionBalanceDiscriminatorBytes(),
    "invalid_discriminator",
    "position balance discriminator does not match",
  );
  if (balance.data.version !== STATE_VERSION) {
    throw new DefinitionVerificationError(
      "invalid_version",
      `unsupported position balance version ${balance.data.version}`,
    );
  }
  if (balance.data.owner !== owner) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "position balance owner does not match",
    );
  }
  requireBytes(
    balance.data.positionId,
    position.data.positionId,
    "invalid_identity",
    "position balance references a different position",
  );
  const [balanceAddress, bump] = await getPositionBalanceAddress(owner, position.data.positionId);
  if (balance.address !== balanceAddress || balance.data.bump !== bump) {
    throw new DefinitionVerificationError(
      "invalid_pda",
      "position balance is not its canonical PDA",
    );
  }
  return balance;
}

export async function getRegisterPositionForCollectionInstruction(input: {
  payer: TransactionSigner;
  collateralMint: Address;
  collectionId: ReadonlyUint8Array;
}) {
  const positionId = derivePositionId(input.collateralMint, input.collectionId);
  const [[collateralConfig], [collection], [position]] = await Promise.all([
    getCollateralAddress(input.collateralMint),
    getCollectionAddress(input.collectionId),
    getPositionAddress(positionId),
  ]);
  return getRegisterPositionInstruction({
    payer: input.payer,
    collateralConfig,
    collection,
    position,
    positionId,
    collateralMint: input.collateralMint,
    collectionId: input.collectionId,
  });
}

export async function getInitializePositionBalanceInstruction(input: {
  payer: TransactionSigner;
  owner: Address;
  positionId: ReadonlyUint8Array;
}) {
  const [[position], [balance]] = await Promise.all([
    getPositionAddress(input.positionId),
    getPositionBalanceAddress(input.owner, input.positionId),
  ]);
  return getInitializeBalanceInstruction({
    payer: input.payer,
    owner: input.owner,
    position,
    balance,
  });
}

export async function getClosePositionBalanceInstruction(input: {
  owner: TransactionSigner;
  positionId: ReadonlyUint8Array;
}) {
  const [[position], [balance]] = await Promise.all([
    getPositionAddress(input.positionId),
    getPositionBalanceAddress(input.owner.address, input.positionId),
  ]);
  return getCloseBalanceInstruction({ owner: input.owner, position, balance });
}

async function verifyPositionIdentity(
  position: Account<PositionDefinition>,
): Promise<Account<PositionDefinition>> {
  verifyProgramAccount(position, "position definition");
  requireBytes(
    position.data.discriminator,
    getPositionDefinitionDiscriminatorBytes(),
    "invalid_discriminator",
    "position discriminator does not match",
  );
  if (position.data.version !== STATE_VERSION) {
    throw new DefinitionVerificationError(
      "invalid_version",
      `unsupported position version ${position.data.version}`,
    );
  }
  const derivedPositionId = derivePositionId(
    position.data.collateralMint,
    position.data.collectionId,
  );
  requireBytes(
    position.data.positionId,
    derivedPositionId,
    "invalid_identity",
    "position ID does not match its definition",
  );
  const [positionAddress, bump] = await getPositionAddress(position.data.positionId);
  if (position.address !== positionAddress || position.data.bump !== bump) {
    throw new DefinitionVerificationError("invalid_pda", "position is not its canonical PDA");
  }
  return position;
}

function verifyProgramAccount(
  account: Account<PositionDefinition> | Account<PositionBalance>,
  name: string,
): void {
  if (account.programAddress !== CC_TOKEN_PROGRAM_ADDRESS || account.executable) {
    throw new DefinitionVerificationError(
      "invalid_owner",
      `${name} is not owned by the cc-token program`,
    );
  }
}

function requireBytes(
  actual: ReadonlyUint8Array,
  expected: ReadonlyUint8Array,
  code: DefinitionVerificationError["code"],
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    !actual.every((byte, index) => byte === expected[index])
  ) {
    throw new DefinitionVerificationError(code, message);
  }
}
