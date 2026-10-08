import assert from "node:assert/strict";
import { test } from "node:test";

import {
  address,
  blockhash,
  generateKeyPairSigner,
  getTransactionSize,
  type AddressesByLookupTableAddress,
} from "@solana/kit";

import {
  buildCcTokenTransaction,
  estimateTransactionCapacity,
  getBatchTransferNativePositionsInstruction,
  planTransactionVersion,
  TransactionCapacityError,
} from "../src/index.ts";

const recipient = address("So11111111111111111111111111111111111111112");
const lookupTable = address("Vote111111111111111111111111111111111111111");

test("measures real v0 and v1 message limits and lookup compression", async () => {
  const owner = await generateKeyPairSigner();
  const instruction = await getBatchTransferNativePositionsInstruction({
    owner,
    recipient,
    transfers: Array.from({ length: 16 }, (_, index) => ({
      positionId: new Uint8Array(32).fill(index + 1),
      amount: 1n,
    })),
  });
  const withoutLookup = estimateTransactionCapacity({
    version: 0,
    feePayer: owner.address,
    instructions: [instruction],
  });
  assert.equal(withoutLookup.sizeLimit, 1_232);
  assert.equal(withoutLookup.fits, false);
  assert.equal(withoutLookup.uniqueAccountCount, 51);

  const lookupTables: AddressesByLookupTableAddress = {
    [lookupTable]: instruction.accounts!.slice(2).map((account) => account.address),
  };
  const withLookup = estimateTransactionCapacity({
    version: 0,
    feePayer: owner.address,
    instructions: [instruction],
    lookupTables,
  });
  assert.equal(withLookup.fits, true);
  assert(withLookup.size < withoutLookup.size);

  assert.equal(
    planTransactionVersion({
      supportedVersions: new Set([0, 1]),
      feePayer: owner.address,
      instructions: [instruction],
    }).version,
    1,
  );
  assert.equal(
    planTransactionVersion({
      supportedVersions: new Set([0, 1]),
      feePayer: owner.address,
      instructions: [instruction],
      v0LookupTables: lookupTables,
    }).version,
    0,
  );
});

test("builds signed v0 and v1 transactions from the selected plan", async () => {
  const owner = await generateKeyPairSigner();
  const instruction = await getBatchTransferNativePositionsInstruction({
    owner,
    recipient,
    transfers: [{ positionId: new Uint8Array(32).fill(91), amount: 5n }],
  });
  const lifetime = {
    blockhash: blockhash("11111111111111111111111111111111"),
    lastValidBlockHeight: 100n,
  };
  for (const version of [0, 1] as const) {
    const transaction = await buildCcTokenTransaction({
      version,
      feePayer: owner,
      instructions: [instruction],
      lifetime,
    });
    assert(getTransactionSize(transaction) > 0);
  }
});

test("reports every attempted capacity when no supported version fits", async () => {
  const owner = await generateKeyPairSigner();
  const data = new Uint8Array(4_100);
  const instruction = {
    programAddress: address("11111111111111111111111111111111"),
    data,
  };
  assert.throws(
    () =>
      planTransactionVersion({
        supportedVersions: new Set([0, 1]),
        feePayer: owner.address,
        instructions: [instruction],
      }),
    (error) => error instanceof TransactionCapacityError && error.estimates.length === 2,
  );
});
