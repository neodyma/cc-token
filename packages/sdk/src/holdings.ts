import { AccountState, fetchAllMaybeToken, type Mint } from "@solana-program/token";
import {
  type Account,
  type Address,
  type FetchAccountConfig,
  type GetTokenAccountsByOwnerApi,
  type Rpc,
} from "@solana/kit";

import {
  fetchMaybeWrapperConfig,
  type PositionBalance,
  type PositionDefinition,
  type WrapperConfig,
} from "./generated/index.ts";
import { getWrapperAddress } from "./identity.ts";
import {
  fetchVerifiedPositionBalance,
  fetchVerifiedPositionDefinition,
} from "./definitions/positions.ts";
import {
  fetchVerifiedWrapper,
  TOKEN_2022_PROGRAM_ADDRESS,
  type VerifiedWrapper,
} from "./definitions/index.ts";

type HoldingsRpc = Parameters<typeof fetchMaybeWrapperConfig>[0] &
  Parameters<typeof fetchAllMaybeToken>[0] &
  Rpc<GetTokenAccountsByOwnerApi>;

export type WrappedTokenHolding = Readonly<{
  address: Address;
  amount: bigint;
  state: "frozen" | "initialized";
}>;

export type PositionHoldings = Readonly<{
  owner: Address;
  position: Account<PositionDefinition>;
  nativeBalance?: Account<PositionBalance>;
  nativeAmount: bigint;
  wrapper?: Readonly<{
    config: Account<WrapperConfig>;
    mint: Account<Mint>;
    tokenAccounts: readonly WrappedTokenHolding[];
    amount: bigint;
  }>;
  totalAmount: bigint;
}>;

export async function fetchPositionHoldings(
  rpc: HoldingsRpc,
  owner: Address,
  positionId: Uint8Array,
  config?: FetchAccountConfig,
): Promise<PositionHoldings> {
  const [position, nativeBalance, [wrapperAddress]] = await Promise.all([
    fetchVerifiedPositionDefinition(rpc, positionId, config),
    fetchVerifiedPositionBalance(rpc, owner, positionId, config),
    getWrapperAddress(positionId),
  ]);
  const wrapperConfig = await fetchMaybeWrapperConfig(rpc, wrapperAddress, config);
  const nativeAmount = nativeBalance.exists ? nativeBalance.account.data.amount : 0n;
  if (!wrapperConfig.exists) {
    return {
      owner,
      position,
      nativeBalance: nativeBalance.exists ? nativeBalance.account : undefined,
      nativeAmount,
      totalAmount: nativeAmount,
    };
  }

  const wrapper = await fetchVerifiedWrapper(rpc, positionId, config);
  const tokenAccounts = await fetchWrapperTokenHoldings(rpc, owner, wrapper, config);
  const wrappedAmount = tokenAccounts.reduce((sum, account) => sum + account.amount, 0n);
  return {
    owner,
    position,
    nativeBalance: nativeBalance.exists ? nativeBalance.account : undefined,
    nativeAmount,
    wrapper: {
      config: wrapper.config,
      mint: wrapper.mint,
      tokenAccounts,
      amount: wrappedAmount,
    },
    totalAmount: nativeAmount + wrappedAmount,
  };
}

async function fetchWrapperTokenHoldings(
  rpc: HoldingsRpc,
  owner: Address,
  wrapper: VerifiedWrapper,
  config?: FetchAccountConfig,
): Promise<readonly WrappedTokenHolding[]> {
  const accounts = await rpc
    .getTokenAccountsByOwner(
      owner,
      { mint: wrapper.mint.address },
      { encoding: "base64", commitment: config?.commitment ?? "confirmed" },
    )
    .send();

  const decodedAccounts = await fetchAllMaybeToken(
    rpc,
    accounts.value.map(({ pubkey }) => pubkey),
    config,
  );
  return decodedAccounts.flatMap((account) => {
    if (!account.exists || account.data.mint !== wrapper.mint.address) {
      return [];
    }
    if (
      account.programAddress !== TOKEN_2022_PROGRAM_ADDRESS ||
      account.data.owner !== owner ||
      account.data.state === AccountState.Uninitialized
    ) {
      throw new Error(
        `wrapper token account ${account.address} does not match the requested holding`,
      );
    }
    return [
      {
        address: account.address,
        amount: account.data.amount,
        state:
          account.data.state === AccountState.Frozen
            ? ("frozen" as const)
            : ("initialized" as const),
      },
    ];
  });
}
