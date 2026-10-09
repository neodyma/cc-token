# cc-token development

- Read [README.md](README.md) for project purpose and layout, [TODO.md](TODO.md) for implementation status and sequencing, and [docs/toolchain.md](docs/toolchain.md) for current toolchain pins and build verification.
- Keep [TODO.md](TODO.md) current whenever implementation work completes, changes scope, or changes the order of remaining stages.
- Keep the Anchor workspace at the repository root; program source is in `programs/cc_token/`.
- Future frontend code belongs in `apps/web/`; shared TypeScript client code belongs in `packages/sdk/`. Do not choose or install a frontend framework without a task that calls for it.
- Put durable public implementation notes in `docs/` and keep repository documentation self-contained.
- Use `cargo fmt` for Rust and the root Prettier scripts for supported text files. Preserve the lockfiles; never commit generated output, wallets, or environment secrets.
- Keep `anchor-lang` and the Anchor CLI pin aligned. `@anchor-lang/core` is a legacy web3.js client; Kit and Umi require their own IDL-generated clients.
- Use disposable local wallets only for testing. Verify the wallet, cluster, program ID, and expected cost before any signed transaction or deployment.
- Update the README status when implementation changes. Report what was actually checked; an empty-program build does not validate the future protocol.
- Add Rust integration tests under `programs/cc_token/tests/` when there is behavior to test
- Add public technical notes under `docs/` as needed

## Project skills

- Solana/Anchor guidance: `.agents/skills/solana-dev/SKILL.md`. Rust guidance: `.agents/skills/rust-best-practices/SKILL.md`. React guidance: `.agents/skills/react-best-practices/SKILL.md`. Browser automation: `.agents/skills/playwright/SKILL.md`.
- Read only the references or React rule files relevant to the current task; do not load the React skill's compiled `AGENTS.md` unless the complete guide is necessary.
- These are vendored upstream references. Repository instructions, explicit user directions, pinned versions and verified runtime behavior take precedence over their generic defaults. Do not downgrade Anchor or Solana to match an older compatibility table.
- Keep SBF builds on SBPF v3: use `pnpm build`, which checks the emitted ELF version. Host Rust tests do not establish SBF runtime compatibility.
- Installing a skill does not authorize changing global configuration or installing its suggested MCP servers, frameworks, dependencies or deployment tooling. Use existing tools and official documentation unless the task calls for additional installation.
- The Playwright skill's helper resolves its CLI dynamically. Use pinned project dependencies for checked-in browser tests.
- Apply Rust advice within SBF's memory/compute constraints and the pinned compiler's supported language features. Use Anchor errors for program failures; do not add host-oriented error or allocation libraries just to follow a generic example.
- Preserve vendored files and licenses. Provenance and hashes are in `.agents/skills.lock.json`; update them deliberately as described in `docs/agent-skills.md`.
