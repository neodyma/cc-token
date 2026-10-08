import type { CcTokenTransactionVersion } from "./transactions.ts";

const MAX_OUTCOME_COUNT = 256;
const MIN_OUTCOME_COUNT = 2;
const MAX_U64 = (1n << 64n) - 1n;

export const MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION = 96;

export type DirectPayoutReportPlan = Readonly<{
  kind: "direct";
  payoutNumerators: readonly bigint[];
}>;

export type StagedPayoutReportPlan = Readonly<{
  kind: "staged";
  payoutNumerators: readonly bigint[];
  chunks: readonly (readonly bigint[])[];
}>;

export type PayoutReportPlan = DirectPayoutReportPlan | StagedPayoutReportPlan;

export function planPayoutReport(
  payoutNumerators: readonly bigint[],
  transactionVersion: CcTokenTransactionVersion,
): PayoutReportPlan {
  validatePayoutNumerators(payoutNumerators);
  const values = [...payoutNumerators];
  if (transactionVersion === 1 || values.length <= MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION) {
    return { kind: "direct", payoutNumerators: values };
  }

  const chunks: bigint[][] = [];
  for (let offset = 0; offset < values.length; offset += MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION) {
    chunks.push(values.slice(offset, offset + MAX_V0_PAYOUT_NUMERATORS_PER_TRANSACTION));
  }
  return { kind: "staged", payoutNumerators: values, chunks };
}

export function validatePayoutNumerators(payoutNumerators: readonly bigint[]): bigint {
  if (payoutNumerators.length < MIN_OUTCOME_COUNT || payoutNumerators.length > MAX_OUTCOME_COUNT) {
    throw new RangeError("payout numerator count must be between 2 and 256");
  }

  let payoutDenominator = 0n;
  for (const payoutNumerator of payoutNumerators) {
    if (payoutNumerator < 0n || payoutNumerator > MAX_U64) {
      throw new RangeError("payout numerator is out of range");
    }
    payoutDenominator += payoutNumerator;
  }
  if (payoutDenominator === 0n) {
    throw new RangeError("payout denominator must be greater than zero");
  }
  return payoutDenominator;
}
