import { fetchMint, type Mint } from "@solana-program/token";
import {
  isNone,
  isSome,
  type Account,
  type Address,
  type FetchAccountConfig,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  fetchMaybeWrapperConfig,
  getWrapperConfigDiscriminatorBytes,
  type PositionDefinition,
  type WrapperConfig,
} from "../generated/index.ts";
import { getWrapperAddress, getWrapperMintAddress } from "../identity.ts";
import { TOKEN_2022_PROGRAM_ADDRESS } from "./collateral.ts";
import { fetchVerifiedPositionDefinition } from "./positions.ts";
import { DefinitionVerificationError } from "./verify.ts";

const STATE_VERSION = 1;

type WrapperRpc = Parameters<typeof fetchMaybeWrapperConfig>[0] & Parameters<typeof fetchMint>[0];

export type VerifiedWrapper = Readonly<{
  config: Account<WrapperConfig>;
  mint: Account<Mint>;
  position: Account<PositionDefinition>;
}>;

export async function fetchVerifiedWrapper(
  rpc: WrapperRpc,
  positionId: ReadonlyUint8Array,
  config?: FetchAccountConfig,
): Promise<VerifiedWrapper> {
  const [[wrapperAddress], [mintAddress], position] = await Promise.all([
    getWrapperAddress(positionId),
    getWrapperMintAddress(positionId),
    fetchVerifiedPositionDefinition(rpc, positionId, config),
  ]);
  const wrapper = await fetchMaybeWrapperConfig(rpc, wrapperAddress, config);
  if (!wrapper.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `wrapper config ${wrapperAddress} does not exist`,
    );
  }
  const mint = await fetchMint(rpc, mintAddress, config);
  return verifyWrapperAccount(wrapper, mint, position);
}

export async function fetchVerifiedWrapperByMint(
  rpc: WrapperRpc,
  mintAddress: Address,
  config?: FetchAccountConfig,
): Promise<VerifiedWrapper> {
  const mint = await fetchMint(rpc, mintAddress, config);
  if (mint.programAddress !== TOKEN_2022_PROGRAM_ADDRESS || isNone(mint.data.mintAuthority)) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "wrapper mint must be owned by Token-2022 and have a mint authority",
    );
  }
  const wrapper = await fetchMaybeWrapperConfig(rpc, mint.data.mintAuthority.value, config);
  if (!wrapper.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `wrapper config ${mint.data.mintAuthority.value} does not exist`,
    );
  }
  const position = await fetchVerifiedPositionDefinition(rpc, wrapper.data.positionId, config);
  return verifyWrapperAccount(wrapper, mint, position);
}

export async function verifyWrapperAccount(
  config: Account<WrapperConfig>,
  mint: Account<Mint>,
  position: Account<PositionDefinition>,
): Promise<VerifiedWrapper> {
  requireBytes(
    config.data.discriminator,
    getWrapperConfigDiscriminatorBytes(),
    "wrapper config discriminator does not match",
  );
  if (
    config.programAddress !== CC_TOKEN_PROGRAM_ADDRESS ||
    config.executable ||
    config.data.version !== STATE_VERSION
  ) {
    throw new DefinitionVerificationError(
      "invalid_owner",
      "wrapper config is not owned by the cc-token program",
    );
  }
  requireBytes(
    config.data.positionId,
    position.data.positionId,
    "wrapper references a different position",
  );

  const [[wrapperAddress, wrapperBump], [mintAddress, mintBump]] = await Promise.all([
    getWrapperAddress(position.data.positionId),
    getWrapperMintAddress(position.data.positionId),
  ]);
  if (
    config.address !== wrapperAddress ||
    config.data.bump !== wrapperBump ||
    config.data.mint !== mintAddress ||
    config.data.mintBump !== mintBump
  ) {
    throw new DefinitionVerificationError("invalid_pda", "wrapper config or mint is not canonical");
  }
  if (
    mint.address !== mintAddress ||
    mint.programAddress !== TOKEN_2022_PROGRAM_ADDRESS ||
    mint.executable ||
    !mint.data.isInitialized ||
    mint.data.decimals !== config.data.decimals ||
    !isSome(mint.data.mintAuthority) ||
    mint.data.mintAuthority.value !== wrapperAddress ||
    !isNone(mint.data.freezeAuthority)
  ) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "wrapper mint does not match its config",
    );
  }
  return { config, mint, position };
}

function requireBytes(
  actual: ReadonlyUint8Array,
  expected: ReadonlyUint8Array,
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    !actual.every((byte, index) => byte === expected[index])
  ) {
    throw new DefinitionVerificationError("invalid_identity", message);
  }
}
