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
| Anchor CLI and `anchor-lang` | 1.2.1   |
| Solana / Agave CLI           | 4.3.0   |
| Host Rust                    | 1.91.1  |
| Node.js                      | 24 LTS  |
| pnpm                         | 10.12.4 |

Install the pinned versions before building. With AVM available:

```sh
avm install 1.2.1
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
pnpm format:check
```

## Devnet

The deployment workflow is documented in [docs/deployment.md](docs/deployment.md). It uses the
pinned toolchain, verifies the devnet genesis hash and built program identity, and performs a dry
run unless `--execute` is supplied.

| Cluster | Program                                                                                                                                           | Source                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Devnet  | [`JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`](https://explorer.solana.com/address/JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW?cluster=devnet) | [`b7ec8d7`](https://github.com/neodyma/cc-token/commit/b7ec8d783fb6d1cae1154480e90bad1fdf2ff9ce) |

The complete public deployment record is in [deployments/devnet.json](deployments/devnet.json).

```sh
pnpm deploy:devnet -- --offline
pnpm devnet:status
```

Neither command changes the global Solana CLI configuration. The repository does not create,
fund or store deployment authorities.
