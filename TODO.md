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
- [ ] Collateral mint registration
- [ ] Collateral policy and Token/Token-2022 validation
- [ ] Canonical collateral vault creation
- [ ] `PositionDefinition`
- [ ] `PositionBalance`
- [ ] Balance initialization
- [ ] Zero-balance closure and reopening
- [ ] SDK retrieval and verification for every definition
- [ ] Runtime tests for the complete lifecycle

## 4. Native position operations

- [ ] Split collateral into positions
- [ ] Split an existing position into refined positions
- [ ] Merge complete child sets back into collateral
- [ ] Merge refined positions into their parent
- [ ] Transfer native positions
- [ ] Bounded batch transfers
- [ ] Automatic first-use destination initialization where practical
- [ ] Tests for insufficient balances, overflow, wrong identities and rollback
- [ ] Diagram examples A, B and C as runtime tests
- [ ] Measured limits for 2, 8 and 16 output operations

## 5. Resolution and redemption

- [x] Exact payout calculation primitive
- [x] Maximum-width and 136-bit arithmetic tests
- [ ] Resolver-authorized payout reporting
- [ ] Immutable final resolution
- [ ] One-factor redemption
- [ ] Redemption to a residual position
- [ ] Redemption to collateral
- [ ] Repeated-factor redemption
- [ ] Fractional, zero-paying and one-hot resolution tests
- [ ] Runtime proof of the one-unit-per-step rounding bound
- [ ] Full 256-entry report through transaction v1
- [ ] Transaction v0-compatible fallback flow where required

## 6. Canonical Token-2022 wrappers

- [ ] Deterministic wrapper configuration
- [ ] Canonical wrapper mint per position
- [ ] Exact native-to-token wrapping
- [ ] Exact token-to-native unwrapping
- [ ] Wrapper transfers through ordinary Token-2022 accounts
- [ ] Mint authority and supply invariants
- [ ] Reverse discovery from wrapper mint to position definition
- [ ] Failure and rollback tests

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
- [ ] Complete definition retrieval (condition and collection retrieval is implemented)
- [ ] Balance discovery across representations
- [ ] Logical subset normalization
- [ ] Explicit repeated-factor construction
- [ ] Split, merge, transfer, resolution, redemption and wrapper builders
- [ ] Transaction capacity estimation
- [ ] Large-operation planning into complete resumable steps
- [ ] Simulation, submission, confirmation and refetch behavior
- [ ] Stable public SDK API

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
- [ ] Transaction-version and practical-capacity documentation
- [ ] Implementation-aligned architecture diagram
- [ ] Public protocol and API documentation
- [ ] Deployment checklist (devnet)
