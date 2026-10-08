import {
  AccountState,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  type Mint,
  type Token,
} from "@solana-program/token";
import {
  address,
  isSome,
  type Account,
  type Address,
  type FetchAccountConfig,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  CollateralFreezeAuthority,
  fetchMaybeCollateralConfig,
  getCollateralConfigDiscriminatorBytes,
  type CollateralConfig,
} from "../generated/index.ts";
import { getCollateralAddress, getVaultAuthorityAddress } from "../identity.ts";
import { DefinitionVerificationError } from "./verify.ts";

const STATE_VERSION = 1;
const COLLATERAL_POLICY_VERSION = 2;

export const TOKEN_2022_PROGRAM_ADDRESS = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export type VerifiedCollateral = Readonly<{
  config: Account<CollateralConfig>;
  mint: Account<Mint>;
  vault: Account<Token>;
  vaultAuthority: Address;
}>;

type CollateralRpc = Parameters<typeof fetchMaybeCollateralConfig>[0] &
  Parameters<typeof fetchMint>[0] &
  Parameters<typeof fetchToken>[0];

export async function fetchVerifiedCollateral(
  rpc: CollateralRpc,
  mintAddress: Address,
  config?: FetchAccountConfig,
): Promise<VerifiedCollateral> {
  const [configAddress] = await getCollateralAddress(mintAddress);
  const collateral = await fetchMaybeCollateralConfig(rpc, configAddress, config);
  if (!collateral.exists) {
    throw new DefinitionVerificationError(
      "missing_definition",
      `collateral config ${configAddress} does not exist`,
    );
  }
  const mint = await fetchMint(rpc, mintAddress, config);
  const vault = await fetchToken(rpc, collateral.data.vault, config);
  return verifyCollateralAccount(collateral, mint, vault);
}

export async function verifyCollateralAccount(
  config: Account<CollateralConfig>,
  mint: Account<Mint>,
  vault: Account<Token>,
): Promise<VerifiedCollateral> {
  if (config.programAddress !== CC_TOKEN_PROGRAM_ADDRESS || config.executable) {
    throw new DefinitionVerificationError(
      "invalid_owner",
      "collateral config is not owned by the cc-token program",
    );
  }
  requireBytes(
    config.data.discriminator,
    getCollateralConfigDiscriminatorBytes(),
    "collateral config discriminator does not match",
  );
  if (
    config.data.version !== STATE_VERSION ||
    config.data.policyVersion !== COLLATERAL_POLICY_VERSION
  ) {
    throw new DefinitionVerificationError(
      "invalid_version",
      "collateral config version is unsupported",
    );
  }
  if (
    config.data.tokenProgram !== TOKEN_PROGRAM_ADDRESS &&
    config.data.tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS
  ) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "collateral token program is unsupported",
    );
  }

  const [configAddress, configBump] = await getCollateralAddress(config.data.mint);
  const [vaultAuthority, vaultAuthorityBump] = await getVaultAuthorityAddress(config.data.mint);
  const [vaultAddress] = await findAssociatedTokenPda({
    owner: vaultAuthority,
    tokenProgram: config.data.tokenProgram,
    mint: config.data.mint,
  });
  if (
    config.address !== configAddress ||
    config.data.bump !== configBump ||
    config.data.vaultAuthorityBump !== vaultAuthorityBump ||
    config.data.vault !== vaultAddress
  ) {
    throw new DefinitionVerificationError(
      "invalid_pda",
      "collateral config or vault is not canonical",
    );
  }

  if (
    mint.address !== config.data.mint ||
    mint.programAddress !== config.data.tokenProgram ||
    mint.executable ||
    !mint.data.isInitialized ||
    mint.data.decimals !== config.data.decimals
  ) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "collateral mint does not match its config",
    );
  }
  if (
    config.data.freezeAuthority === CollateralFreezeAuthority.Unfreezable &&
    isSome(mint.data.freezeAuthority)
  ) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "collateral freeze authority does not match its config",
    );
  }
  if (
    vault.address !== vaultAddress ||
    vault.programAddress !== config.data.tokenProgram ||
    vault.executable ||
    vault.data.mint !== config.data.mint ||
    vault.data.owner !== vaultAuthority ||
    vault.data.state === AccountState.Uninitialized
  ) {
    throw new DefinitionVerificationError(
      "invalid_identity",
      "collateral vault does not match its config",
    );
  }

  return { config, mint, vault, vaultAuthority };
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
    throw new DefinitionVerificationError("invalid_discriminator", message);
  }
}
