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
- **Live** reports whether the program is deployed on devnet and whether a wallet is connected. It does not send transactions yet.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev:web
```

Then open <http://localhost:5173>. `pnpm build` is needed once so the program IDL exists; `pnpm dev:web` regenerates the SDK client from it and starts the Vite dev server.

The wallet button targets Solana devnet. Set `VITE_SOLANA_RPC_URL` to use a different RPC endpoint.

## Devnet

The deployment workflow is documented in [docs/deployment.md](docs/deployment.md). It uses the
pinned toolchain, verifies the devnet genesis hash and built program identity, and performs a dry
run unless `--execute` is supplied.

```sh
pnpm deploy:devnet -- --offline
pnpm devnet:status
```

Neither command changes the global Solana CLI configuration. The repository does not create,
fund or store deployment authorities.
