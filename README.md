# cc-token

Combinatorial conditional tokens for Solana.

## Layout

```text
Anchor.toml                  Anchor workspace and localnet configuration
Cargo.toml                   Rust workspace
programs/cc_token/src/lib.rs Program entrypoints
pnpm-workspace.yaml          JavaScript workspace (apps/* and packages/*)
```

`apps/web/` contains the frontend, `packages/sdk/` contains the shared clients. The frontend consumes the SDK through a workspace dependency. SDK owns ID derivation, instruction building, and generated client exports.

## Toolchain

| Tool                         | Version |
| ---------------------------- | ------- |
| Anchor CLI and `anchor-lang` | 1.2.0   |
| Solana / Agave CLI           | 4.0.2   |
| Host Rust                    | 1.91.1  |
| Node.js                      | 24 LTS  |
| pnpm                         | 10.12.4 |

Install the pinned versions before building. With AVM available:

```sh
avm install 1.2.0
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
pnpm format:check
```
