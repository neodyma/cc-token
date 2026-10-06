# Project-local agent skills

Skills are vendored in `.agents/skills/` so their instructions and references travel with this repository. They are ordinary files, not Git submodules or links into a developer's home directory. Codex discovers this location when started in `cc-token` or a subdirectory; an existing conversation started in the parent workspace may need to open the project directly. See [local skill discovery](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

| Skill                 | Upstream                                                                   | Scope                                                       |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `solana-dev`          | [Solana Foundation](https://github.com/solana-foundation/solana-dev-skill) | Anchor programs, SVM constraints, IDLs, clients and testing |
| `rust-best-practices` | [Apollo GraphQL](https://github.com/apollographql/skills)                  | Rust ownership, error handling, performance and tests       |

The Solana skill includes Anchor guidance, so a separate overlapping Anchor skill is unnecessary. No frontend-specific skill or framework has been installed. Both upstream packages are MIT-licensed; each vendored directory includes its upstream license.

Exact source commits, upstream paths and per-file SHA-256 hashes are recorded in [the provenance lockfile](../.agents/skills.lock.json). Upstream skill content is unchanged; the root upstream licenses are also copied into the corresponding skill directories. Prettier excludes the vendored directories to preserve those bytes.

Follow the project overrides in [AGENTS.md](../AGENTS.md). In particular, upstream version tables can lag releases, and host-oriented Rust patterns do not automatically fit SBF. Skill installation does not install a suggested MCP server or change global tool settings.

For an update, select and review an upstream commit, install the selected skill into a temporary directory with the Skill Installer's `--ref` and `--dest` options, and inspect the diff before replacing the vendored copy. Include its license, refresh the source revision and file hashes, and check local links. Do not run an unpinned update as part of normal builds.
