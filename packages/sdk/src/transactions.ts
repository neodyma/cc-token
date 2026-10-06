export type CcTokenTransactionVersion = 0 | 1;

export function selectTransactionVersion(
  supportedVersions: ReadonlySet<CcTokenTransactionVersion>,
  preferV1 = true,
): CcTokenTransactionVersion {
  if (preferV1 && supportedVersions.has(1)) return 1;
  if (supportedVersions.has(0)) return 0;
  throw new Error("wallet must support transaction version 0 or 1");
}
