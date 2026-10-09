import { deriveConditionId } from "@cc-token/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Address } from "@solana/kit";

import { toHex, type DemoCondition } from "../scenario.ts";
import type { ChainCondition } from "./discovery.ts";

// The chain stores a question as a 32-byte ID and a number of results. The ID is the hash of a
// small document holding the wording, which is published as a memo when the question is
// prepared. Anyone can read it back and check it against the ID, so the wording needs no trust.
export type StoredQuestion = Readonly<{
  title: string;
  outcomes: readonly string[];
  questionId: string;
  resolver: Address;
  // The exact text that hashes to the question ID. Missing for questions made before memos.
  document?: string;
}>;

const MEMO_PREFIX = "cc-token:question:";
// Leaves room for the rest of the transaction in one packet.
const MAX_MEMO_BYTES = 600;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

// The salt makes each prepared question new, so a resolved one can be asked again.
export function newQuestion(
  resolver: Address,
  title: string,
  outcomes: readonly string[],
  salt: string,
): StoredQuestion {
  const document = JSON.stringify({ title, outcomes, salt });
  const questionId = keccak_256(new TextEncoder().encode(document));
  return { title, outcomes, questionId: toHex(questionId), resolver, document };
}

// The memo to publish with the question, or null when its wording is too long for one.
export function questionMemo(question: StoredQuestion): string | null {
  if (question.document === undefined) return null;
  const memo = `${MEMO_PREFIX}${question.document}`;
  return new TextEncoder().encode(memo).length <= MAX_MEMO_BYTES ? memo : null;
}

// Reads a question's wording out of a transaction memo. Returns null unless the document
// hashes to the ID the condition holds on-chain, so a forged memo cannot rename a question.
export function questionFromMemo(memo: string, condition: ChainCondition): StoredQuestion | null {
  const start = memo.indexOf(MEMO_PREFIX);
  if (start === -1) return null;
  const document = memo.slice(start + MEMO_PREFIX.length);
  if (toHex(keccak_256(new TextEncoder().encode(document))) !== toHex(condition.questionId)) {
    return null;
  }
  try {
    const parsed = JSON.parse(document) as { title?: unknown; outcomes?: unknown };
    const { title, outcomes } = parsed;
    if (
      typeof title !== "string" ||
      !Array.isArray(outcomes) ||
      outcomes.length !== condition.outcomeCount ||
      !outcomes.every((outcome) => typeof outcome === "string")
    ) {
      return null;
    }
    return {
      title,
      outcomes,
      questionId: toHex(condition.questionId),
      resolver: condition.resolver,
      document,
    };
  } catch {
    return null;
  }
}

export function toCondition(question: StoredQuestion): DemoCondition {
  const questionId = fromHex(question.questionId);
  const conditionId = deriveConditionId(question.resolver, questionId, question.outcomes.length);
  return {
    key: toHex(conditionId),
    title: question.title,
    question: question.title,
    outcomes: question.outcomes,
    resolver: question.resolver,
    questionId,
    conditionId,
  };
}

// A question found on-chain that this browser has no wording for.
export function unnamedCondition(condition: ChainCondition): DemoCondition {
  const key = toHex(condition.conditionId);
  return {
    key,
    title: `Question ${key.slice(0, 6)}`,
    question: "Its resolver published no wording for it, so only its identifier is known.",
    outcomes: Array.from(
      { length: condition.outcomeCount },
      (_, outcome) => `result ${outcome + 1}`,
    ),
    resolver: condition.resolver,
    questionId: new Uint8Array(32),
    conditionId: condition.conditionId,
  };
}

export function loadQuestions(storage: Storage, key: string): readonly StoredQuestion[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(stored) ? (stored as StoredQuestion[]) : [];
  } catch {
    return [];
  }
}

export function saveQuestions(
  storage: Storage,
  key: string,
  questions: readonly StoredQuestion[],
): void {
  storage.setItem(key, JSON.stringify(questions));
}
