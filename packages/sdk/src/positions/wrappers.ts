import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import {
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

import {
  getInitializeWrapperInstruction as getGeneratedInitializeWrapperInstruction,
  getUnwrapPositionInstruction as getGeneratedUnwrapPositionInstruction,
  getWrapPositionInstruction as getGeneratedWrapPositionInstruction,
} from "../generated/index.ts";
import {
  getCollateralAddress,
  getPositionAddress,
  getPositionBalanceAddress,
  getWrapperAddress,
  getWrapperMintAddress,
} from "../identity.ts";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../definitions/collateral.ts";

const MAX_U64 = 0xffff_ffff_ffff_ffffn;

export type InitializeCanonicalWrapperInput = Readonly<{
  payer: TransactionSigner;
  collateralMint: Address;
  positionId: ReadonlyUint8Array;
}>;

export type WrapperTokenAccountInput = Readonly<{
  payer: TransactionSigner;
  owner: Address;
  positionId: ReadonlyUint8Array;
}>;

export type WrapNativePositionInput = Readonly<{
  owner: TransactionSigner;
  positionId: ReadonlyUint8Array;
  amount: bigint;
  destination?: Address;
}>;

export type UnwrapWrappedPositionInput = Readonly<{
  owner: TransactionSigner;
  positionId: ReadonlyUint8Array;
  amount: bigint;
  source?: Address;
}>;

export async function getInitializeCanonicalWrapperInstruction(
  input: InitializeCanonicalWrapperInput,
): Promise<Instruction> {
  const [[position], [collateralConfig], [wrapper], [mint]] = await Promise.all([
    getPositionAddress(input.positionId),
    getCollateralAddress(input.collateralMint),
    getWrapperAddress(input.positionId),
    getWrapperMintAddress(input.positionId),
  ]);
  return getGeneratedInitializeWrapperInstruction({
    payer: input.payer,
    position,
    collateralConfig,
    wrapper,
    mint,
  });
}

export async function getCreateWrapperTokenAccountInstruction(
  input: WrapperTokenAccountInput,
): Promise<Instruction> {
  const [mint] = await getWrapperMintAddress(input.positionId);
  const [ata] = await findAssociatedTokenPda({
    owner: input.owner,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    mint,
  });
  return getCreateAssociatedTokenIdempotentInstruction({
    payer: input.payer,
    ata,
    owner: input.owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
}

export async function getWrapNativePositionInstruction(
  input: WrapNativePositionInput,
): Promise<Instruction> {
  validateAmount(input.amount);
  const [[position], [balance], [wrapper], [mint]] = await Promise.all([
    getPositionAddress(input.positionId),
    getPositionBalanceAddress(input.owner.address, input.positionId),
    getWrapperAddress(input.positionId),
    getWrapperMintAddress(input.positionId),
  ]);
  const destination =
    input.destination ??
    (
      await findAssociatedTokenPda({
        owner: input.owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        mint,
      })
    )[0];
  return getGeneratedWrapPositionInstruction({
    owner: input.owner,
    position,
    balance,
    wrapper,
    mint,
    destination,
    amount: input.amount,
  });
}

export async function getUnwrapWrappedPositionInstruction(
  input: UnwrapWrappedPositionInput,
): Promise<Instruction> {
  validateAmount(input.amount);
  const [[position], [balance], [wrapper], [mint]] = await Promise.all([
    getPositionAddress(input.positionId),
    getPositionBalanceAddress(input.owner.address, input.positionId),
    getWrapperAddress(input.positionId),
    getWrapperMintAddress(input.positionId),
  ]);
  const source =
    input.source ??
    (
      await findAssociatedTokenPda({
        owner: input.owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        mint,
      })
    )[0];
  return getGeneratedUnwrapPositionInstruction({
    owner: input.owner,
    position,
    balance,
    wrapper,
    mint,
    source,
    amount: input.amount,
  });
}

function validateAmount(amount: bigint): void {
  if (amount <= 0n || amount > MAX_U64) {
    throw new RangeError("amount must be between 1 and u64::MAX");
  }
}
