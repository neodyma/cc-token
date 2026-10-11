import { fetchMint, type Mint } from "@solana-program/token";
import {
  getBase58Decoder,
  getBase64Encoder,
  getAddressDecoder,
  isNone,
  isSome,
  type Account,
  type Address,
  type FetchAccountConfig,
  type GetProgramAccountsApi,
  type ReadonlyUint8Array,
  type Rpc,
  type Base58EncodedBytes,
} from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  fetchMaybeWrapperConfig,
  getWrapperConfigDecoder,
  getWrapperConfigDiscriminatorBytes,
  type PositionDefinition,
  type WrapperConfig,
} from "../generated/index.ts";
import { getWrapperAddress, getWrapperMintAddress } from "../identity.ts";
import { TOKEN_2022_PROGRAM_ADDRESS } from "./collateral.ts";
import { fetchVerifiedPositionDefinition } from "./positions.ts";
import { DefinitionVerificationError } from "./verify.ts";

const STATE_VERSION = 1;
const WRAPPER_CONFIG_SPACE = 76n;

type WrapperRpc = Parameters<typeof fetchMaybeWrapperConfig>[0] & Parameters<typeof fetchMint>[0];

type WrapperDiscoveryRpc = WrapperRpc & Rpc<GetProgramAccountsApi>;

export type VerifiedWrapper = Readonly<{
  config: Account<WrapperConfig>;
  mint: Account<Mint>;
  position: Account<PositionDefinition>;
}>;

export async function fetchCanonicalWrapperConfigs(
  rpc: WrapperDiscoveryRpc,
  config?: FetchAccountConfig,
): Promise<readonly Account<WrapperConfig>[]> {
  const discriminator = getBase58Decoder().decode(
    getWrapperConfigDiscriminatorBytes(),
  ) as Base58EncodedBytes;
  const found = await rpc
    .getProgramAccounts(CC_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      commitment: config?.commitment ?? "confirmed",
      filters: [
        { dataSize: WRAPPER_CONFIG_SPACE },
        { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
      ],
    })
    .send();
  const decoder = getWrapperConfigDecoder();
  const configs: Account<WrapperConfig>[] = [];
  for (const { pubkey, account } of found) {
    try {
      const bytes = getBase64Encoder().encode(account.data[0]);
      const configAccount = {
        address: pubkey,
        data: decoder.decode(bytes),
        executable: account.executable,
        lamports: account.lamports,
        programAddress: account.owner,
        space: BigInt(bytes.length),
      } satisfies Account<WrapperConfig>;
      await verifyWrapperConfigIdentity(configAccount);
      configs.push(configAccount);
    } catch {
      // Malformed program accounts must not block discovery of valid wrappers.
    }
  }
  return configs;
}

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
    config.data.positionId,
    position.data.positionId,
    "wrapper references a different position",
  );
  await verifyWrapperConfigIdentity(config);

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

async function verifyWrapperConfigIdentity(
  config: Account<WrapperConfig>,
): Promise<Account<WrapperConfig>> {
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
  const [[wrapperAddress, wrapperBump], [mintAddress, mintBump]] = await Promise.all([
    getWrapperAddress(config.data.positionId),
    getWrapperMintAddress(config.data.positionId),
  ]);
  if (
    config.address !== wrapperAddress ||
    config.data.bump !== wrapperBump ||
    config.data.mint !== mintAddress ||
    config.data.mintBump !== mintBump
  ) {
    throw new DefinitionVerificationError("invalid_pda", "wrapper config or mint is not canonical");
  }
  return config;
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

export type WrapperMetadata = Readonly<{
  updateAuthority: Address;
  mint: Address;
  name: string;
  symbol: string;
  uri: string;
  // The program writes position_id, collection_id and collateral_mint.
  fields: Readonly<Record<string, string>>;
}>;

// Token-2022 pads a mint to the size of a token account, marks the account type, then lists
// extensions as type (u16), length (u16) and value.
const MINT_EXTENSIONS_OFFSET = 166;
const TOKEN_METADATA_EXTENSION = 19;

/**
 * Reads the metadata the program stores in a wrapper mint. Returns null for a mint without it,
 * as wrappers created before metadata was added are.
 */
export function readWrapperMetadata(data: ReadonlyUint8Array): WrapperMetadata | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = MINT_EXTENSIONS_OFFSET;
  while (offset + 4 <= data.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const start = offset + 4;
    if (start + length > data.length) return null;
    if (type !== TOKEN_METADATA_EXTENSION) {
      offset = start + length;
      continue;
    }

    let cursor = start;
    const end = start + length;
    const take = (size: number): ReadonlyUint8Array => {
      if (cursor + size > end) throw new RangeError("wrapper metadata is truncated");
      cursor += size;
      return data.slice(cursor - size, cursor);
    };
    const text = (): string => {
      const size = view.getUint32(cursor, true);
      take(4);
      return new TextDecoder().decode(take(size));
    };
    try {
      const updateAuthority = getAddressDecoder().decode(take(32));
      const mint = getAddressDecoder().decode(take(32));
      const name = text();
      const symbol = text();
      const uri = text();
      const count = view.getUint32(cursor, true);
      take(4);
      const fields: Record<string, string> = {};
      for (let index = 0; index < count; index += 1) {
        const key = text();
        fields[key] = text();
      }
      return { updateAuthority, mint, name, symbol, uri, fields };
    } catch {
      return null;
    }
  }
  return null;
}
