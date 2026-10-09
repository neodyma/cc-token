# Web demo on devnet

The program is deployed on devnet at `JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`; [deployment.md](deployment.md) describes the deployment workflow. This page describes how the web demo uses it.

## Using the Live page

```sh
pnpm build
pnpm dev:web
```

The Live page at <http://localhost:5173/#/live> needs the program on devnet and a connected wallet set to devnet with some devnet SOL. It then offers:

1. **A collateral token.** "Create a test token" makes a new SPL token that the wallet can mint, names it "cc-token test collateral" (TEST), mints 1,000 of it and registers it as collateral, in one transaction. The program accepts only plain mints as collateral, so the name is stored in a Metaplex metadata account, which wallets and explorers read. A test token made before this can be named afterwards by the wallet that created it. A token the wallet already holds can be used instead.
2. **Questions.** Preparing a question makes the connected wallet its resolver. The chain stores only a 32-byte question ID and the number of results. The ID is the hash of a small JSON document with the wording and the names of the results, and the page publishes that document as a memo in the transaction that prepares the question. Any wallet can read the memo back and check it against the ID, so a position shows the same names wherever it is opened. A question prepared without a memo shows placeholder names.
3. **Positions.** Deposit, split, merge and redeem act on the box selected in the graph, as in the simulator. There is no market on-chain, so there is no Buy / Sell.
4. **Sending.** Send moves native shares of the selected position to any wallet address. The recipient needs no account or setup beforehand: the sender pays for its balance account, and it finds the position on its own Live page.
5. **Wrapping.** Wrap exchanges native shares one for one for the position's Token-2022 token, which other wallets and programs can hold; the first wrap of a position creates its mint. Unwrap takes it back. Split, merge and redeem act on native shares only. Wrapped positions are found from the wallet's Token-2022 accounts, so one received from someone else shows up too.
6. **Results.** Only a question's resolver can report its result, and a reported result is final.

Positions are read with `getProgramAccounts` filtered by owner, then rebuilt from the registered collections. The chain keeps balances and not the splits that produced them, so the graph draws each position under the narrowest held position it can be cut from.

A wallet that was only sent positions starts from its address alone. The first screen lists the collateral tokens it holds positions of, found from its balance accounts and from its Token-2022 accounts whose mint is a position's wrapper. Opening one shows the positions with their questions and results, and the same split, merge, wrap, unwrap and redeem actions.

A new position needs its collection, position and balance accounts. The page skips the ones that exist and packs the rest into as few version-0 transactions as fit, so a first deposit takes two or three approvals and a repeat takes one.

## What was checked

`pnpm test:integration` runs `apps/web/test/live.integration.ts` against a local validator loaded with the compiled program. It uses the same Kit client stack as the browser with a generated keypair in place of the wallet, and covers test collateral, two questions, deposit, narrowing, combining, each kind of merge, sending native shares to a new address, wrapping, unwrapping, a wrapped token sent to and unwrapped by another wallet, which finds the collateral and the question wording from its address alone, an unauthorized report, both reports and redemption to a residual position and to collateral.

By hand, on 2026-10-09, from Phantom on devnet: creating a test token, preparing questions, deposits, splits, reporting results and redeeming. Sending, wrapping, unwrapping and naming a token have not been confirmed from a browser, and there are no automated browser tests.
