# Toolchain and SBPF build

The operational pins are in `Anchor.toml`, the Cargo manifests/lockfile and `scripts/build.mjs`.

| Component                  | Pin         |
| -------------------------- | ----------- |
| Anchor CLI / `anchor-lang` | **1.2.1**   |
| Solana / Agave CLI         | **4.3.0**   |
| SBF platform tools         | **v1.57**   |
| Program architecture       | **SBPF v3** |
| Host Rust                  | 1.91.1      |
| Node.js                    | 24.x        |
| pnpm                       | 10.12.4     |

Solana 4.3.0 and Anchor 1.2.1 were the latest stable upstream releases checked on 2026-10-06. The latter was published that day. Sources: [Agave release](https://github.com/anza-xyz/agave/releases/tag/v4.3.0), [Anchor release](https://github.com/otter-sec/anchor/releases/tag/v1.2.1). A newer validator/CLI release does not imply that every on-chain `solana-*` dependency should receive that same version number.

## Installation and selection

Install the exact releases using AVM and the [Agave installation instructions](https://docs.anza.xyz/cli/install). The build script checks these conventional versioned installation paths first:

```text
~/.avm/bin/anchor-1.2.1
~/.local/share/solana/install/releases/4.3.0/solana-release/bin/
```

`pnpm build` reads the project pins, selects the matching installed AVM binary and prepends the matching Solana release directory only for its child processes. It validates both reported versions before compiling. If those conventional installation paths do not exist, it accepts matching binaries on `PATH`; a version mismatch fails with an installation hint. This keeps project builds independent of the globally selected versions.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check:sbpf
pnpm check
pnpm test
pnpm format:check
```

The build runs the pinned Anchor CLI with `--arch v3 --tools-version v1.57`, then checks `target/deploy/cc_token.so`. The verifier requires a little-endian ELF64 BPF artifact with `e_flags = 0x3`; a missing, malformed or older-version artifact fails the command. The checks inspect the actual compiler output rather than only trusting the build arguments. See [Solana's SBPF v3 guidance](https://solana.com/es/upgrades/sbpfv3-programs).

`[workspace.metadata.cli]` also records Solana 4.3.0 for builds and a future verifiable-build workflow. The initial devnet deployment used the ordinary pinned build recorded in [deployments/devnet.json](../deployments/devnet.json); no verifiable build has been published yet.

SBPF v3 is the program binary format. Transaction v1 is the client/network message format. The SDK builds and tests both transaction formats; applications must still gate transaction v1 on wallet support and provide the required resource configuration. The core program's financial state machine does not need a different algebra for transaction v1. See [transaction v1 support](https://solana.com/upgrades/larger-transaction-sizes).

The root test command builds and verifies the SBPF v3 artifact, runs host Rust and TypeScript tests, executes the compiled program through LiteSVM, and submits version 0 plus optional version 1 transactions to a pinned local validator. Build outputs, generated clients, validator ledgers and disposable wallets stay ignored.
