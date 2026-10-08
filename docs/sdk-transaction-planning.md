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
Simulation remains responsible for runtime compute, account-data and program validation.

## Large operations

Complete refinements are divided into transitions of at most 16 children. Each intermediate split
produces up to 15 requested subsets and one remainder. Later steps split that remainder until the
target partition exists. Merges execute the same transitions in reverse order.

Batch transfers are consolidated by position and divided into instructions of at most 16 positions.
Every setup instruction and value transition receives a deterministic step ID. Completed IDs must
form a prefix of the plan before execution resumes.

Setup instructions are idempotent and execute separately from value transitions. Each value
transition is complete and preserves protocol accounting on its own.

## Execution

`executeConfirmedPlan` builds, simulates, submits, confirms and refetches after each step. A failed
simulation is never submitted. Errors identify the phase and step, retain prior receipts and include
simulation logs or a submitted signature when available.

A confirmation or refetch error may follow a successful submission. Callers should check the
signature and current state before resuming rather than submitting that step again blindly.
