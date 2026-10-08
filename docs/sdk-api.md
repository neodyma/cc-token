# SDK API

Import supported application APIs from `@cc-token/sdk`. The root export contains identity,
composition, verified account retrieval, instruction builders, operation planning, transaction
selection and execution.

Raw Codama output is available as `generatedClient` from the root module or from
`@cc-token/sdk/generated`. Generated codecs, raw account fetchers and instruction layouts are an
advanced interface and may change when the IDL is regenerated.

## Transactions

Use `selectTransactionVersion` with the versions supported by the connected wallet. Version 0 is
the compatibility path. Version 1 is optional and should only be selected when the wallet supports
it and the operation benefits from its larger message.

`buildCcTokenTransaction` fetches requested address lookup tables from the supplied RPC before it
compiles and signs a version-0 transaction. Supply `computeUnitLimit` when measured version-0 work
exceeds the runtime default. Version 1 receives compute and loaded-account-data limits in the
message configuration.

## Confirmed plans

Flatten a complete instruction plan with `flattenInstructionPlan`, then pass its steps to
`executeConfirmedPlan`. `createKitExecutionAdapter` provides the Solana Kit implementation for
blockhash retrieval, live lookup-table loading, signing, simulation, submission, confirmation and
state refetching.

Every adapter requires a checkpoint store. `MemoryPlanCheckpointStore` lasts for the current
process. `WebStoragePlanCheckpointStore` accepts `localStorage`, `sessionStorage` or another object
with the same `getItem`, `setItem` and `removeItem` methods. It preserves bigints and byte arrays.
Use durable storage for any multi-transaction operation.

On restart, execution checks the original signature and waits for an unresolved submission. It
builds a replacement only after the original transaction has failed or its blockhash has expired.
The program still treats a separately signed repetition as a new owner-authorized operation.

## Collateral

`fetchVerifiedCollateral` authenticates the config, mint and vault. Collateral registered with an
active freeze authority is classified as issuer controlled. Root deposits reject that class unless
`acceptIssuerControlled` is explicitly true. SDK split builders default it to false.

The issuer can freeze token accounts outside the cc-token program. Merge and redemption do not add
a policy gate, but their token transfer can fail while the affected vault or destination account is
frozen.
