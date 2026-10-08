import assert from "node:assert/strict";
import { test } from "node:test";

import { type Mint } from "@solana-program/token";
import { address, lamports, none, some, type Account, type Address } from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  deriveCollectionId,
  derivePositionId,
  getPositionAddress,
  getWrapperAddress,
  getWrapperMintAddress,
  ROOT_COLLECTION_ID,
  TOKEN_2022_PROGRAM_ADDRESS,
  verifyWrapperAccount,
  type PositionDefinition,
  type WrapperConfig,
} from "../src/index.ts";
import {
  getPositionDefinitionDiscriminatorBytes,
  getWrapperConfigDiscriminatorBytes,
} from "../src/generated/index.ts";

const firstCollateral = address("So11111111111111111111111111111111111111112");
const secondCollateral = address("Vote111111111111111111111111111111111111111");

test("derives exactly one canonical mint for each semantic position", async () => {
  const conditionId = new Uint8Array(32).fill(17);
  const firstOutcome = deriveCollectionId(ROOT_COLLECTION_ID, conditionId, [
    1n,
    0n,
    0n,
    0n,
  ]).collectionId;
  const secondOutcome = deriveCollectionId(ROOT_COLLECTION_ID, conditionId, [
    2n,
    0n,
    0n,
    0n,
  ]).collectionId;
  const repeatedFirstOutcome = deriveCollectionId(firstOutcome, conditionId, [
    1n,
    0n,
    0n,
    0n,
  ]).collectionId;

  const firstPosition = derivePositionId(firstCollateral, firstOutcome);
  const semanticPositions = [
    firstPosition,
    derivePositionId(firstCollateral, secondOutcome),
    derivePositionId(secondCollateral, firstOutcome),
    derivePositionId(firstCollateral, repeatedFirstOutcome),
  ];
  const [[canonicalMint], [sameCanonicalMint], ...otherMints] = await Promise.all([
    getWrapperMintAddress(firstPosition),
    getWrapperMintAddress(Uint8Array.from(firstPosition)),
    ...semanticPositions.slice(1).map(getWrapperMintAddress),
  ]);

  assert.equal(canonicalMint, sameCanonicalMint);
  const allMints = [canonicalMint, ...otherMints.map(([mint]) => mint)];
  assert.equal(new Set(allMints).size, semanticPositions.length);
});

test("authenticates the canonical wrapper mint and rejects a different position", async () => {
  const collectionId = deriveCollectionId(ROOT_COLLECTION_ID, new Uint8Array(32).fill(23), [
    1n,
    0n,
    0n,
    0n,
  ]).collectionId;
  const positionId = derivePositionId(firstCollateral, collectionId);
  const [positionAddress, positionBump] = await getPositionAddress(positionId);
  const [wrapperAddress, wrapperBump] = await getWrapperAddress(positionId);
  const [mintAddress, mintBump] = await getWrapperMintAddress(positionId);
  const position: Account<PositionDefinition> = account(positionAddress, CC_TOKEN_PROGRAM_ADDRESS, {
    discriminator: getPositionDefinitionDiscriminatorBytes(),
    version: 1,
    positionId,
    collateralMint: firstCollateral,
    collectionId,
    bump: positionBump,
  });
  const wrapper: Account<WrapperConfig> = account(wrapperAddress, CC_TOKEN_PROGRAM_ADDRESS, {
    discriminator: getWrapperConfigDiscriminatorBytes(),
    version: 1,
    positionId,
    mint: mintAddress,
    decimals: 6,
    bump: wrapperBump,
    mintBump,
  });
  const mint: Account<Mint> = account(mintAddress, TOKEN_2022_PROGRAM_ADDRESS, {
    mintAuthority: some(wrapperAddress),
    supply: 50n,
    decimals: 6,
    isInitialized: true,
    freezeAuthority: none(),
  });

  assert.deepEqual(await verifyWrapperAccount(wrapper, mint, position), {
    config: wrapper,
    mint,
    position,
  });

  const otherPositionId = derivePositionId(secondCollateral, collectionId);
  await assert.rejects(
    () =>
      verifyWrapperAccount(
        { ...wrapper, data: { ...wrapper.data, positionId: otherPositionId } },
        mint,
        position,
      ),
    /different position/,
  );
});

function account<T extends object>(
  addressValue: Address,
  programAddress: Address,
  data: T,
): Account<T> {
  return {
    address: addressValue,
    data,
    executable: false,
    lamports: lamports(1n),
    programAddress,
    space: 0n,
  };
}
