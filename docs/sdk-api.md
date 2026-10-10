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

## Wrapper metadata

`initialize_wrapper` creates a position's Token-2022 mint with a metadata pointer to itself and
stores token metadata in the mint, so wallets and explorers show more than an address:

| Field             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| name              | `CC-T #` and the first 8 hex characters of the position ID |
| symbol            | `CCP`                                                      |
| `position_id`     | the position ID, hex                                       |
| `collection_id`   | the collection ID, hex                                     |
| `collateral_mint` | the collateral mint address                                |

Every value comes from the authenticated position definition; the caller supplies none. The
wrapper config is the mint authority and the metadata update authority, and no instruction signs
for it to change metadata, so the metadata is fixed once written. The payer of
`initialize_wrapper` covers the rent for the larger mint. The question wording behind a position
is not on-chain and is not part of the metadata.

No link is set. Token metadata always has a URI field, and the program leaves it empty, so wallets
show the name and symbol without an icon or description. A link would have to be derived by the
program from the position ID, never supplied by a caller, which fixes a host name in every mint for
good. That needs a stable host serving one JSON document per position, and is left for later.

`readWrapperMetadata` decodes it from a mint account's data and returns `null` for a mint without
it. A wrapper created before this change keeps its plain mint: it wraps and unwraps as before, has
no metadata, and calling `initialize_wrapper` on it again fails instead of being a no-op.

The program deployed on devnet does not include this yet.
