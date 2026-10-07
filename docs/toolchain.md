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

The public README was preserved at the user's request during this update; its original version table predates these pins.

## Installation and selection

Install the exact releases using AVM and the [Agave installation instructions](https://docs.anza.xyz/cli/install). On the development machine, the official macOS ARM64 binaries were downloaded, checked against the SHA-256 digests in GitHub's release metadata and installed alongside the existing releases:

```text
~/.avm/bin/anchor-1.2.1
~/.local/share/solana/install/releases/4.3.0/solana-release/bin/
```

Global AVM and Solana active-release selections were left unchanged. `pnpm build` reads the project pins, selects the matching installed AVM binary and prepends the matching Solana release directory only for its child processes. It validates both reported versions before compiling. If those conventional installation paths do not exist, it accepts matching binaries on `PATH`; a version mismatch fails with an installation hint.

This explicit selection also avoids an older global Anchor launcher rejecting newer build flags before it delegates to the workspace version. For an interactive shell using the project Solana CLI, prepend the installed release directory to that shell's `PATH`.

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

`[workspace.metadata.cli]` also records Solana 4.3.0 for a future verifiable-build workflow. No deployment or verifiable on-chain build has been performed.

SBPF v3 is the program binary format. Transaction v1 is the client/network message format. This toolchain supports preparing for both, but the SDK still needs a v1-capable builder and wallet, correct resource configuration, and integration tests. The core program's financial state machine does not need a different algebra for transaction v1. See [transaction v1 support](https://solana.com/upgrades/larger-transaction-sizes).

The root test command builds and verifies the SBPF v3 artifact, runs host Rust and TypeScript tests, executes the compiled program through LiteSVM, and submits version 0 plus optional version 1 transactions to a pinned local validator. Build outputs, generated clients, validator ledgers and disposable wallets stay ignored.
