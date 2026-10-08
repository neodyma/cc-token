import assert from "node:assert/strict";
import { test } from "node:test";

import { AccountRole, address, generateKeyPairSigner } from "@solana/kit";

import {
  getBatchTransferNativePositionsInstruction,
  getBatchTransferSetupInstructions,
  getPositionAddress,
  getPositionBalanceAddress,
  getTransferNativePositionInstruction,
  normalizeBatchTransfers,
} from "../src/index.ts";
import {
  getBatchTransferPositionsInstructionDataDecoder,
  getTransferPositionInstructionDataDecoder,
} from "../src/generated/index.ts";

const recipient = address("So11111111111111111111111111111111111111112");

function positionId(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

test("builds a single transfer with canonical source and destination balances", async () => {
  const owner = await generateKeyPairSigner();
  const id = positionId(1);
  const instruction = await getTransferNativePositionInstruction({
    owner,
    recipient,
    positionId: id,
    amount: 25n,
  });

  assert.equal(instruction.accounts?.length, 6);
  assert.equal(instruction.accounts?.[2]?.address, (await getPositionAddress(id))[0]);
  assert.equal(
    instruction.accounts?.[3]?.address,
    (await getPositionBalanceAddress(owner.address, id))[0],
  );
  assert.equal(
    instruction.accounts?.[5]?.address,
    (await getPositionBalanceAddress(recipient, id))[0],
  );
  assert.equal(instruction.accounts?.[3]?.role, AccountRole.WRITABLE);
  assert.equal(instruction.accounts?.[5]?.role, AccountRole.WRITABLE);
  const data = getTransferPositionInstructionDataDecoder().decode(instruction.data!);
  assert.equal(data.recipient, recipient);
  assert.deepEqual(data.positionId, id);
  assert.equal(data.amount, 25n);
});

test("rejects self-transfers", async () => {
  const owner = await generateKeyPairSigner();
  const id = positionId(2);
  await assert.rejects(
    () =>
      getTransferNativePositionInstruction({
        owner,
        recipient: owner.address,
        positionId: id,
        amount: 1n,
      }),
    /must differ/,
  );
  await assert.rejects(
    () =>
      getBatchTransferNativePositionsInstruction({
        owner,
        recipient: owner.address,
        transfers: [{ positionId: id, amount: 1n }],
      }),
    /must differ/,
  );
});

test("consolidates duplicate batch entries and preserves first-seen order", async () => {
  const owner = await generateKeyPairSigner();
  const first = positionId(3);
  const second = positionId(4);
  const transfers = [
    { positionId: first, amount: 2n },
    { positionId: second, amount: 4n },
    { positionId: first, amount: 3n },
  ];
  const normalized = normalizeBatchTransfers(transfers);
  assert.deepEqual(
    normalized.map(({ positionId, amount }) => [positionId[0], amount]),
    [
      [3, 5n],
      [4, 4n],
    ],
  );

  const instruction = await getBatchTransferNativePositionsInstruction({
    owner,
    recipient,
    transfers,
  });
  assert.equal(instruction.accounts?.length, 8);
  const data = getBatchTransferPositionsInstructionDataDecoder().decode(instruction.data!);
  assert.equal(data.recipient, recipient);
  assert.deepEqual(
    data.positionIds,
    normalized.map(({ positionId }) => positionId),
  );
  assert.deepEqual(data.amounts, [5n, 4n]);
  for (let index = 0; index < normalized.length; index += 1) {
    const id = normalized[index]!.positionId;
    assert.equal(instruction.accounts?.[2 + index * 3]?.address, (await getPositionAddress(id))[0]);
    assert.equal(
      instruction.accounts?.[3 + index * 3]?.address,
      (await getPositionBalanceAddress(owner.address, id))[0],
    );
    assert.equal(
      instruction.accounts?.[4 + index * 3]?.address,
      (await getPositionBalanceAddress(recipient, id))[0],
    );
  }

  const setup = await getBatchTransferSetupInstructions({ payer: owner, recipient, transfers });
  assert.equal(setup.length, 2);
});

test("rejects invalid amounts, identifiers and oversized batches", async () => {
  const owner = await generateKeyPairSigner();
  assert.throws(() => normalizeBatchTransfers([]), /empty/);
  assert.throws(
    () => normalizeBatchTransfers([{ positionId: positionId(1), amount: 0n }]),
    /amount/,
  );
  assert.throws(
    () => normalizeBatchTransfers([{ positionId: new Uint8Array(31), amount: 1n }]),
    /32 bytes/,
  );
  assert.throws(
    () =>
      normalizeBatchTransfers([
        { positionId: positionId(1), amount: 0xffff_ffff_ffff_ffffn },
        { positionId: positionId(1), amount: 1n },
      ]),
    /exceeds/,
  );
  await assert.rejects(
    () =>
      getBatchTransferNativePositionsInstruction({
        owner,
        recipient,
        transfers: Array.from({ length: 17 }, (_, index) => ({
          positionId: positionId(index),
          amount: 1n,
        })),
      }),
    /at most 16/,
  );
  await assert.rejects(
    () =>
      getTransferNativePositionInstruction({
        owner,
        recipient,
        positionId: positionId(1),
        amount: 0n,
      }),
    /amount/,
  );
});
