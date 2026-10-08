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
