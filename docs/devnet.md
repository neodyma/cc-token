# Web demo on devnet

The program is deployed on devnet at `JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`; [deployment.md](deployment.md) describes the deployment workflow. This page describes how the web demo uses it.

## Using the Live page

```sh
pnpm build
pnpm dev:web
```

The Live page at <http://localhost:5173/#/live> lists published scenarios without a wallet. A connected wallet set to devnet with some devnet SOL can also use the transaction controls:

1. **A collateral token.** The “Create a scenario” dialog can make a new SPL token that the wallet can mint: it takes a name and a symbol, mints 1,000 of the token and registers it as collateral, in one transaction. The program accepts only plain mints as collateral, so the name is stored in a Metaplex metadata account, which wallets and explorers read. A test token made before names were added can be named afterwards by the wallet that created it. The creator can instead select a token used before or paste any classic SPL or Token-2022 mint, whether or not the wallet already holds it. An unregistered mint is registered during creation. Wrapped SOL (`So11111111111111111111111111111111111111112`) can be pasted like any other mint, so a scenario can be backed by SOL that every wallet can obtain. On the graph of a SOL-backed scenario or token, “Wrap SOL” moves an amount of the wallet's SOL into its wrapped SOL account and “Unwrap all” closes that account, returning all of it as SOL; the token program cannot unwrap only a part. A merge or redemption recreates the account when it was closed.
2. **Questions.** A question is prepared in the same dialog, or from the graph of a token. Preparing a question makes the connected wallet its resolver. The chain stores only a 32-byte question ID and the number of results. The ID is the hash of a small JSON document with the wording and the names of the results, and the page publishes that document as a memo in the transaction that prepares the question. Any wallet can read the memo back and check it against the ID, so a position shows the same names wherever it is opened. A question prepared without a memo shows placeholder names.
3. **Scenarios.** Publishing gives a condition basis a creator-controlled name and a canonical zero-balance anchor. It does not deposit collateral. Discovery reads every descriptor from the program and puts active scenarios with exact or compatible wallet holdings first. A graph has its own address, `#/live/scenario/<address>` for a scenario or `#/live/token/<mint>` for everything the wallet holds of one token. Opening a scenario without a wallet shows its featured split path as a read-only graph. With a wallet connected, the graph includes only positions whose condition multiset belongs to that scenario basis. A position on a shared subset can therefore appear in more than one scenario; unrelated positions backed by the same token do not appear. The connected graph has one action that deposits and splits down to its featured position. “Create a scenario” takes the collateral token, the questions, the results the featured position pays on and the name, and sends one transaction for each part that is not on-chain yet. A position already in the graph can also be published under a name from its own actions.
4. **Positions.** Deposit, split, merge and redeem act on the box selected in the graph, as in the simulator. There is no market on-chain, so there is no Buy / Sell. Redeeming settles one question at a time and leaves the position without that question. The redeem menu lists the last question of the position first, because what it leaves is the box the position was split from; redeeming an earlier question first leaves a position outside the scenario's tree, which the graph draws under the wallet. Once every question has a result, “Redeem all” settles them last first, in as few transactions as fit, down to collateral.
5. **Sending.** Send moves native shares of the selected position to any wallet address. The recipient needs no account or setup beforehand: the sender pays for its balance account, and it finds the position on its own Live page.
6. **Wrapping.** Wrap exchanges native shares one for one for the position's Token-2022 token, which other wallets and programs can hold; the first wrap of a position creates its mint. Unwrap takes it back. Split, merge and redeem act on native shares only. Wrapped positions are found from the wallet's Token-2022 accounts after intersecting them with the program's canonical wrappers.
7. **Results.** Only a question's resolver can report its result, and a reported result is final.

Positions are read with `getProgramAccounts` filtered by owner, then rebuilt from the registered collections. The chain keeps balances and not the splits that produced them, so the graph draws each position under the narrowest held position it can be cut from.

A wallet that was only sent positions starts from its address alone. The Live page lists the collateral tokens it holds positions of under “Your positions”, found from its balance accounts and from its Token-2022 accounts whose mint is a position's wrapper. Opening one shows the positions with their questions and results, and the same split, merge, wrap, unwrap and redeem actions.

A new position needs its collection, position and balance accounts. The page skips the ones that exist and uses version-0 transactions. Taking a scenario position checkpoints the value-moving split for each question; first-use account setup can require additional transactions. If a later approval, submission or page session stops the flow, the action resumes from those checkpoints and does not deposit the root collateral twice.

## Requests to the RPC endpoint

Every read the pages make goes through `apps/web/src/live/pacing.ts`: at most four requests are in flight at once, one that the endpoint turns away with HTTP 429 is repeated after a wait, and a read repeated with the same parameters within two seconds reuses the first answer. Reads made after a transaction name its slot and are never reused.

For local development against a private endpoint, put `VITE_SOLANA_RPC_URL=<endpoint>` in `apps/web/.env.local`, which is not committed, and restart the dev server.

## Private RPC on Vercel

The browser uses `VITE_SOLANA_RPC_URL` when it is set and otherwise calls the public devnet RPC.
Like every Vite variable, `VITE_SOLANA_RPC_URL` is public and must not contain a provider secret.

For a Vercel deployment whose Root Directory is `apps/web`, set `SOLANA_RPC_URL` to the complete
HTTPS endpoint in the Vercel project's server-side environment variables, then redeploy. Its
presence during `vite build` enables `/api/rpc`; the value itself is read only by the Vercel
Function at runtime. If the variable is absent, or the application runs through plain `vite dev`,
the browser keeps using the public endpoint as before.

The function accepts same-origin browser POSTs, an allowlist of the RPC methods used by the Live
page, requests up to 64 KiB and batches of at most 10 calls. It forwards provider `429` responses
and `Retry-After` without returning the configured URL. Origin checks prevent ordinary cross-site
browser use but are not authentication: a direct client can forge browser headers. Apply a Vercel
Firewall rate limit to `/api/rpc` if the provider plan needs an enforceable traffic budget.

Vercel Functions do not proxy WebSockets here. Solana subscriptions continue to use the public
devnet WebSocket endpoint; transaction bodies, simulations and account reads use the configured
HTTP provider.

## What was checked

`pnpm test:integration` runs `apps/web/test/live.integration.ts` against a local validator loaded with the compiled program. It uses the same Kit client stack as the browser with a generated keypair in place of the wallet, and covers test collateral, three questions, multiple zero-balance scenario publications, discovery, renaming, one position participating in two scenarios, scenario graph filtering, creation against a pasted mint the creator does not hold, deposit, narrowing, combining, each kind of merge, sending native shares to a new address, wrapping, unwrapping, a wrapped token sent to and unwrapped by another wallet, an unauthorized report, both reports, redemption to a residual position and to collateral, and resuming an interrupted featured-position acquisition without depositing twice. A second test registers wrapped SOL, wraps SOL twice, deposits it, unwraps the remainder and merges back into a recreated account.

By hand, on 2026-10-09, from Phantom on devnet: creating a test token, preparing questions, deposits, splits, reporting results and redeeming. Sending, wrapping, unwrapping, naming a token and the wrapped SOL controls have not been confirmed from a browser, and there are no automated browser tests.

## Deployed-program submission test

`pnpm test:devnet` targets the deployed program rather than starting a local validator. It requires
an explicit disposable keypair and performs a read-only preflight unless `--execute` is present.
Use a dedicated RPC through environment variables when available:

```sh
export CC_TOKEN_DEVNET_RPC_URL="https://your-devnet-rpc"
export CC_TOKEN_DEVNET_WS_URL="wss://your-devnet-websocket"

pnpm test:devnet -- --payer .local/devnet-test-payer.json
pnpm test:devnet -- --payer .local/devnet-test-payer.json --execute
```

The payer must hold at least 0.25 devnet SOL. The test verifies the cluster and deployed program,
then creates test collateral, prepares two conditions, publishes one named scenario, splits and
refines collateral, transfers and wraps a position, reports payouts, redeems every claim, and
closes zero-valued native balance accounts. It leaves the scenario and immutable definition
accounts on devnet. A successful run writes public addresses and confirmed transaction signatures
to an ignored JSON receipt under `target/devnet-tests/`.

Custom RPC credentials stay in the environment. The command redacts RPC paths and query strings
from its output and never prints keypair contents.
