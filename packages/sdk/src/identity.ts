import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
  type ReadonlyUint8Array,
} from "@solana/kit";

import { CC_TOKEN_PROGRAM_ADDRESS } from "./generated/programs/ccToken.ts";

const BASE_FIELD_MODULUS =
  21_888_242_871_839_275_222_246_405_745_257_275_088_696_311_157_297_823_662_689_037_894_645_226_208_583n;
const CONDITION_DOMAIN = new TextEncoder().encode("SVM_CTF_V1");
const POSITION_DOMAIN = new TextEncoder().encode("SVM_CTF_POSITION_V1");
const CONDITION_SEED = new TextEncoder().encode("condition");
const COLLECTION_SEED = new TextEncoder().encode("collection");
const PAYOUT_REPORT_SEED = new TextEncoder().encode("payout_report");

export const ROOT_COLLECTION_ID = new Uint8Array(32);

export type IndexSetWords = readonly [bigint, bigint, bigint, bigint];

type Point = Readonly<{ x: bigint; y: bigint }>;

export function deriveConditionId(
  resolver: Address,
  questionId: ReadonlyUint8Array,
  outcomeCount: number,
): Uint8Array {
  if (questionId.length !== 32) throw new RangeError("questionId must contain 32 bytes");
  if (!Number.isInteger(outcomeCount) || outcomeCount < 2 || outcomeCount > 256) {
    throw new RangeError("outcomeCount must be between 2 and 256");
  }
  return keccak_256(
    concatBytes(
      CONDITION_DOMAIN,
      getAddressEncoder().encode(resolver),
      questionId,
      Uint8Array.of(outcomeCount & 0xff, outcomeCount >>> 8),
    ),
  );
}

export function deriveCollectionId(
  parentCollectionId: ReadonlyUint8Array,
  conditionId: ReadonlyUint8Array,
  indexSet: IndexSetWords,
): Readonly<{ collectionId: Uint8Array; hashAttempts: number }> {
  assertIdentifier(parentCollectionId, "parentCollectionId");
  assertIdentifier(conditionId, "conditionId");
  const atomic = deriveAtomicPoint(conditionId, indexSet);
  const point = bytesEqual(parentCollectionId, ROOT_COLLECTION_ID)
    ? atomic.point
    : addPoints(decodeCollectionId(parentCollectionId), atomic.point);
  if (!point) throw new Error("collection composition produced the identity point");
  return { collectionId: encodeCollectionId(point), hashAttempts: atomic.hashAttempts };
}

export function derivePositionId(
  collateralMint: Address,
  collectionId: ReadonlyUint8Array,
): Uint8Array {
  assertIdentifier(collectionId, "collectionId");
  if (bytesEqual(collectionId, ROOT_COLLECTION_ID)) {
    throw new RangeError("the collateral root does not have a position ID");
  }
  return keccak_256(
    concatBytes(POSITION_DOMAIN, getAddressEncoder().encode(collateralMint), collectionId),
  );
}

export function encodeIndexSet(indexSet: IndexSetWords): Uint8Array {
  if (indexSet.length !== 4) throw new RangeError("indexSet must contain four words");
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 4; index += 1) {
    let word = indexSet[index];
    if (word < 0n || word > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError("indexSet words must fit in u64");
    }
    for (let byte = 0; byte < 8; byte += 1) {
      bytes[31 - index * 8 - byte] = Number(word & 0xffn);
      word >>= 8n;
    }
  }
  return bytes;
}

export function getConditionAddress(
  conditionId: ReadonlyUint8Array,
): Promise<ProgramDerivedAddress> {
  assertIdentifier(conditionId, "conditionId");
  return getProgramDerivedAddress({
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    seeds: [CONDITION_SEED, conditionId],
  });
}

export function getCollectionAddress(
  collectionId: ReadonlyUint8Array,
): Promise<ProgramDerivedAddress> {
  assertIdentifier(collectionId, "collectionId");
  return getProgramDerivedAddress({
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    seeds: [COLLECTION_SEED, collectionId],
  });
}

export function getPayoutReportAddress(
  conditionId: ReadonlyUint8Array,
): Promise<ProgramDerivedAddress> {
  assertIdentifier(conditionId, "conditionId");
  return getProgramDerivedAddress({
    programAddress: CC_TOKEN_PROGRAM_ADDRESS,
    seeds: [PAYOUT_REPORT_SEED, conditionId],
  });
}

function deriveAtomicPoint(
  conditionId: ReadonlyUint8Array,
  indexSet: IndexSetWords,
): Readonly<{ point: Point; hashAttempts: number }> {
  const hash = keccak_256(concatBytes(conditionId, encodeIndexSet(indexSet)));
  const odd = (hash[0]! & 0x80) !== 0;
  let x = bytesToBigInt(hash) % BASE_FIELD_MODULUS;
  let hashAttempts = 0;

  while (true) {
    x = (x + 1n) % BASE_FIELD_MODULUS;
    hashAttempts += 1;
    const ySquared = modulo(x * x * x + 3n);
    let y = modularPower(ySquared, (BASE_FIELD_MODULUS + 1n) / 4n);
    if (modulo(y * y) !== ySquared) continue;
    if ((y & 1n) !== (odd ? 1n : 0n)) y = BASE_FIELD_MODULUS - y;
    return { point: { x, y }, hashAttempts };
  }
}

function decodeCollectionId(collectionId: ReadonlyUint8Array): Point {
  if (bytesEqual(collectionId, ROOT_COLLECTION_ID) || (collectionId[0]! & 0x80) !== 0) {
    throw new Error("collection ID is not a valid BN254 encoding");
  }
  const encodedX = Uint8Array.from(collectionId);
  const odd = (encodedX[0]! & 0x40) !== 0;
  encodedX[0]! &= 0x3f;
  const x = bytesToBigInt(encodedX);
  if (x >= BASE_FIELD_MODULUS) throw new Error("collection ID is not a valid BN254 encoding");
  const ySquared = modulo(x * x * x + 3n);
  let y = modularPower(ySquared, (BASE_FIELD_MODULUS + 1n) / 4n);
  if (modulo(y * y) !== ySquared) {
    throw new Error("collection ID is not a valid BN254 encoding");
  }
  if ((y & 1n) !== (odd ? 1n : 0n)) y = BASE_FIELD_MODULUS - y;
  return { x, y };
}

function encodeCollectionId(point: Point): Uint8Array {
  const collectionId = bigIntToBytes(point.x);
  collectionId[0]! |= Number(point.y & 1n) << 6;
  return collectionId;
}

function addPoints(left: Point, right: Point): Point | null {
  if (left.x === right.x && modulo(left.y + right.y) === 0n) return null;
  const slope =
    left.x === right.x && left.y === right.y
      ? modulo(3n * left.x * left.x * modularInverse(2n * left.y))
      : modulo((right.y - left.y) * modularInverse(right.x - left.x));
  const x = modulo(slope * slope - left.x - right.x);
  const y = modulo(slope * (left.x - x) - left.y);
  return { x, y };
}

function modularInverse(value: bigint): bigint {
  const normalized = modulo(value);
  if (normalized === 0n) throw new Error("point addition produced an invalid slope");
  return modularPower(normalized, BASE_FIELD_MODULUS - 2n);
}

function modularPower(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = modulo(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = modulo(result * factor);
    factor = modulo(factor * factor);
    remaining >>= 1n;
  }
  return result;
}

function modulo(value: bigint): bigint {
  const result = value % BASE_FIELD_MODULUS;
  return result < 0n ? result + BASE_FIELD_MODULUS : result;
}

function bytesToBigInt(bytes: ReadonlyUint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function concatBytes(...values: ReadonlyUint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function assertIdentifier(value: ReadonlyUint8Array, name: string): void {
  if (value.length !== 32) throw new RangeError(`${name} must contain 32 bytes`);
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
