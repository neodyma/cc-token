# Implementation stages

## 1. Toolchain and runtime foundation

- [x] Anchor workspace and program scaffold
- [x] Solana 4.3.0 and Anchor 1.2.1 pins
- [x] SBPF v3 build and artifact verification
- [x] Rust unit-test setup
- [x] LiteSVM program-test harness
- [x] Local Agave validator harness
- [x] Codama-generated Kit client
- [x] Transaction v0 compatibility path
- [x] Optional transaction v1 path
- [x] Single `pnpm test` command for all tests

## 2. Canonical identity and protocol primitives

- [x] 256-bit outcome masks
- [x] Condition IDs
- [x] BN254 atomic collections
- [x] Root and nested collection composition
- [x] Order-independent composition
- [x] Repeated-factor semantics
- [x] Condition registration
- [x] Collection registration and first-witness preservation
- [x] Partition validation
- [x] Position IDs scoped by collateral mint
- [x] Exact wide payout arithmetic
- [x] Rust and TypeScript parity
- [x] Shared compatibility fixtures
- [x] Boundary coverage through 256 outcomes
- [x] Arbitrary-precision payout verification

## 3. Registries and native account lifecycle

- [x] `Condition` definition
- [x] `CollectionDefinition`
- [x] `prepare_condition`
- [x] `register_collection`
- [x] Collateral mint registration
- [x] Collateral policy and Token/Token-2022 validation
- [x] Freeze-authority classification and deposit opt-in
- [x] Canonical collateral vault creation
- [x] `PositionDefinition`
- [x] `PositionBalance`
- [x] Balance initialization
- [x] Zero-balance closure and reopening
- [x] SDK retrieval and verification for every definition
- [x] Runtime tests for the complete lifecycle

## 4. Native position operations

- [x] Split collateral into root positions
- [x] Split an existing position into refined positions
- [x] Merge complete root sets back into collateral
- [x] Merge refined positions into their parent
- [x] Transfer native positions
- [x] Bounded batch transfers
- [x] Automatic first-use destination initialization where practical
- [x] Root-operation tests for insufficient balances, overflow, wrong identities and rollback
- [x] Diagram examples A, B and C as runtime tests
- [x] Measured limits for 2, 8 and 16 output root operations

## 5. Resolution and redemption

- [x] Exact payout calculation primitive
- [x] Maximum-width and 136-bit arithmetic tests
- [x] Resolver-authorized payout reporting
- [x] Immutable final resolution
- [x] One-factor redemption
- [x] Redemption to a residual position
- [x] Redemption to collateral
- [x] Repeated-factor redemption
- [x] Fractional, zero-paying and one-hot resolution tests
- [x] Runtime proof of the one-unit-per-step rounding bound
- [x] Full 256-entry report through transaction v1
- [x] Transaction v0-compatible fallback flow where required

## 6. Canonical Token-2022 wrappers

- [x] Deterministic wrapper configuration
- [x] Canonical wrapper mint per position
- [x] Exact native-to-token wrapping
- [x] Exact token-to-native unwrapping
- [x] Wrapper transfers through ordinary Token-2022 accounts
- [x] Mint authority and supply invariants
- [x] Reverse discovery from wrapper mint to position definition
- [x] Failure and rollback tests

## 7. Compression compatibility and compressed balances (deferred)

### Compatibility proof

- [ ] Compile against the selected Light interfaces
- [ ] Execute a real addressed compressed-account create/update
- [ ] Establish program IDs and local proof infrastructure
- [ ] Confirm compatibility with current Anchor and Solana

### Compressed backend

- [ ] Canonical compressed balance identity
- [ ] Native-to-compressed migration
- [ ] Compressed-to-native migration
- [ ] Compressed transfer
- [ ] Compressed split, merge and redemption
- [ ] Native and compressed coexistence
- [ ] Stale-proof and consumed-input protection
- [ ] Runtime measurements and parity with native transitions

## 8. SDK and transaction planning

- [x] Generated Kit client
- [x] Condition and collection derivation
- [x] Position derivation
- [x] Partition and payout helpers
- [x] Transaction-version selection
- [x] Complete definition retrieval
- [x] Balance discovery across representations
- [x] Logical subset normalization
- [x] Explicit repeated-factor construction
- [x] Split, merge, transfer, resolution, redemption and wrapper builders
- [x] Transaction capacity estimation
- [x] Lookup-table verification at signing
- [x] Large-operation planning into complete resumable steps
- [x] Plan-scoped execution checkpoints and reconciliation
- [x] Simulation, submission, confirmation and refetch behavior
- [x] Stable public SDK API

## 9. Scenario Composer

- [ ] Vite/React application
- [ ] Condition and position inspection
- [ ] Grouped partition construction
- [ ] Split, merge, transfer, resolve, redeem, wrap and unwrap flows
- [ ] Native/compressed balance breakdown
- [ ] Optional advanced multiplicative construction
- [ ] Version-0-only wallet behavior
- [ ] Optional transaction v1 behavior
- [ ] Browser error and interrupted-flow tests
- [ ] Complete LOI demonstration

## 10. Release validation and handoff

- [ ] Full deterministic and property-test suite
- [ ] Conservation model across native, compressed and wrapped balances (deferred)
- [ ] Clean build
- [ ] CU, transaction-size, account, heap and rent measurements
- [ ] Supported collateral and authority documentation
- [ ] Rounding and resolution documentation
- [ ] Compression availability documentation (deferred)
- [x] Transaction-version and practical-capacity documentation
- [ ] Implementation-aligned architecture diagram
- [ ] Public protocol and API documentation
- [x] Deployment checklist and scripts (devnet; deployment pending)
