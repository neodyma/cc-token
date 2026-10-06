# cc-token development

- Read `README.md` for project purpose and layout, and `docs/toolchain.md` for current toolchain pins and build verification.
- Keep the Anchor workspace at the repository root; program source is in `programs/cc_token/`.
- Future frontend code belongs in `apps/web/`; shared TypeScript client code belongs in `packages/sdk/`. Do not choose or install a frontend framework without a task that calls for it.
- Private proposals and review notes belong in the sibling `../cc-token-local/`, never this repository. Public implementation notes may go in `docs/`.
- Use `cargo fmt` for Rust and the root Prettier scripts for supported text files. Preserve the lockfiles; never commit generated output, wallets, or environment secrets.
- Keep `anchor-lang` and the Anchor CLI pin aligned. `@anchor-lang/core` is a legacy web3.js client; Kit and Umi require their own IDL-generated clients.
- Use disposable local wallets only for testing. Verify the wallet, cluster, program ID, and expected cost before any signed transaction or deployment.
- Update the README status when implementation changes. Report what was actually checked; an empty-program build does not validate the future protocol.
- Add Rust integration tests under `programs/cc_token/tests/` when there is behavior to test
- Add public technical notes under `docs/` as needed
