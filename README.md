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

## Web demo

`apps/web/` is a browser demo with three pages:

- **How it works** explains the protocol in plain terms.
- **Simulator** is one interactive graph of positions: prepare questions, deposit, split, merge, trade against a simulated market maker, report results and redeem. It uses the SDK for identifiers and payouts and sends no transactions.
- **Live** runs the same graph against the program deployed on devnet. With a connected wallet it creates a test collateral token, prepares questions, deposits, splits, merges, sends positions to other wallets, wraps and unwraps them as Token-2022 tokens, reports results and redeems, each as real transactions. It reads positions back from the program's accounts. See [docs/devnet.md](docs/devnet.md).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev:web
```

Then open <http://localhost:5173>. `pnpm build` is needed once so the program IDL exists; `pnpm dev:web` regenerates the SDK client from it and starts the Vite dev server.

The wallet button targets Solana devnet. Set `VITE_SOLANA_RPC_URL` to use a different devnet RPC
endpoint.

The Live page's transactions are tested against a local validator by `pnpm test:integration`, with
a keypair in place of the wallet. There are no automated browser tests.

## Devnet

The deployment workflow is documented in [docs/deployment.md](docs/deployment.md). It uses the
pinned toolchain, verifies the devnet genesis hash and built program identity, and performs a dry
run unless `--execute` is supplied.

| Cluster | Program                                                                                                                                           | Source                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Devnet  | [`JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`](https://explorer.solana.com/address/JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW?cluster=devnet) | [`0ea8cb3`](https://github.com/neodyma/cc-token/commit/0ea8cb372827e0e7e0c06fcaccaf07d6a5f71d98) |

The complete public deployment record is in [deployments/devnet.json](deployments/devnet.json).

```sh
pnpm deploy:devnet -- --offline
pnpm devnet:status
```

Neither command changes the global Solana CLI configuration. The repository does not create,
fund or store deployment authorities.
