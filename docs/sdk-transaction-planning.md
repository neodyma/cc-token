# SDK transaction planning

## Holdings

`fetchPositionHoldings` verifies the position definition and native balance, then checks for a
canonical Token-2022 wrapper. When a wrapper exists, it finds every token account owned by the
requested address for that mint and returns native, wrapped and total units separately.

The total is denominated in registered collateral units. The helper does not infer a relationship
between those units and another underlying asset.

## Capacity

`estimateTransactionCapacity` compiles the supplied instructions with Solana Kit and measures the
resulting message. It reports message size, the applicable size limit, instruction data, unique
accounts, signers, writable accounts and address lookup tables.

`planTransactionVersion` uses transaction v0 when it fits. A v0 address lookup table can make a
large account set fit the 1,232-byte limit. Transaction v1 is selected when v0 does not fit, or when
the caller explicitly prefers v1. The v1 estimate includes the configured compute-unit and loaded
account-data limits.

Capacity estimation only proves that a message can be encoded within its version's size limit.
The estimator accepts a supplied lookup-table map because it does not sign. The transaction builder
accepts table addresses and an RPC instead, then fetches their ordered contents immediately before
compilation and signing. Use the same trusted cluster RPC for lookup tables, blockhashes and
submission. Simulation remains responsible for runtime compute, account-data and program
validation. Transfer instruction data also commits the recipient and ordered position IDs; the
program rejects resolved accounts that do not match that signed intent.

## Large operations

Complete refinements are divided into transitions of at most 16 children. Each intermediate split
produces up to 15 requested subsets and one remainder. Later steps split that remainder until the
target partition exists. Merges execute the same transitions in reverse order.

Batch transfers are consolidated by position and divided into instructions of at most 16 positions.
Every executable plan has a versioned fingerprint over its ordered instructions, program addresses,
account roles and data. Step IDs are namespaced by that plan ID. Completed records include both IDs,
must belong to the current plan and must form a prefix before execution resumes.

Setup instructions are idempotent and execute separately from value transitions. Each value
transition is complete and preserves protocol accounting on its own.

## Execution

`executeConfirmedPlan` loads and reconciles any durable checkpoint before it can build a step. It
then builds, signs and simulates a fresh step and records the signed transaction and its signature
before submission. It records submitted, confirmed and refetched states in order. A failed
simulation is never submitted. Errors identify the plan, phase and step, retain prior receipts and
include the latest checkpoint.

`reconcileExecutionCheckpoint` checks an interrupted step by its original signature. An unknown
signature remains pending and is not rebuilt. A confirmed transaction resumes at refetch. A new
transaction may be built only after the original signature is definitively failed or expired. The
application chooses the durable checkpoint store.

The program deliberately allows an owner to authorize the same split or transfer more than once.
Those are distinct valid operations, so the contract cannot classify a newly signed repetition as
accidental without adding operation-nonce state. Resubmitting the same signed transaction preserves
its signature; the checkpoint rule prevents the client from replacing an ambiguous submission with
a separately signed transaction.
