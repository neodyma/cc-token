# Devnet deployment

The devnet deployment is a public integration target for the SDK and Scenario Composer. It is not
a production release or a security endorsement. Keep the program upgradeable while integration is
active; do not use `--final` on devnet.

The program has no global administrator or bootstrap account. Once its executable is deployed,
users can register supported collateral, prepare conditions and construct positions through the
ordinary permissionless instructions.

## Current deployment

| Field                  | Value                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster                | Devnet                                                                                                                                                    |
| Program                | [`JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`](https://explorer.solana.com/address/JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW?cluster=devnet)         |
| ProgramData            | `5yGC1NyFVmHPvz5Y7rwJVjT7mdc23unsapQWbT1WepeL`                                                                                                            |
| Deployment slot        | `509656589`                                                                                                                                               |
| Deployment transaction | [`5nZoRz…VdWR2d`](https://explorer.solana.com/tx/5nZoRzmZqWoDKet67xFv6SNjEjuFCheTWJ9veAroYwyWBAXF2Lu4ZDzeU8R5EYk5NvgWv1TTqE2s5YNtabVdWR2d?cluster=devnet) |
| Source                 | [`f4ade4a`](https://github.com/neodyma/cc-token/commit/f4ade4ad1df6a7bd6e090376e5b3a7f00f015266)                                                          |
| Artifact SHA-256       | `3cabd05f4a017ecba774854a5f9ded14a4b4c6b3cf334d06219386211658d351`                                                                                        |

The machine-readable record is [deployments/devnet.json](../deployments/devnet.json). The SDK
exports this program address as `CC_TOKEN_PROGRAM_ADDRESS`.

## Program identity and signers

`pnpm build` writes the program ID declared by the compiled program to
`target/idl/cc_token.json`. The deployment script uses that generated value instead of duplicating
an address in its command line or configuration. An initial deployment also needs a program
keypair with the same public key. An upgrade only needs the existing program address and its
current upgrade authority.

Anchor normally places a development copy of the program keypair at
`target/deploy/cc_token-keypair.json`. Store the deployment copy outside generated build output
before the initial deployment because build cleanup can remove `target/`. Never commit a keypair.

The deployer pays transaction fees and becomes the upgrade authority for an initial deployment.
The repository does not create, fund or store deployment authorities.

## Pre-deployment checklist

1. Start from the reviewed revision intended for deployment and run `pnpm test` and
   `pnpm format:check`.
2. Prepare and fund a devnet deployer with enough SOL for program rent, the temporary loader
   buffer and transaction fees.
3. For an initial deployment, provide the program keypair that matches the ID in the built IDL.
4. Optionally provide a buffer keypair so an interrupted upload can be resumed.
5. Run the deployment command without `--execute`. Review the cluster, program, operation,
   signers, artifact hash, Git state and rent estimate.
6. Repeat the command with `--execute` when the plan is correct.

The script builds with the pinned Anchor, Solana, platform tools and SBPF v3 configuration before
preparing a deployment. It verifies the devnet genesis hash and inspects any program already at the
built address. An upgrade must use the on-chain upgrade authority, and an initial deployment must
use a matching program keypair. The RPC URL, fee payer and authority are passed to the Solana CLI
explicitly, preflight remains enabled, and global CLI configuration is not changed.

## Commands

Build the artifact and inspect its identity without using RPC or submitting a transaction:

```sh
pnpm deploy:devnet -- --offline
```

Inspect devnet without signing. The program ID is read from the most recent built IDL:

```sh
pnpm devnet:status
```

To inspect another program without rebuilding, pass its public address explicitly:

```sh
pnpm devnet:status -- --program-id <PROGRAM_ID>
```

Prepare a dry run. Relative paths are resolved from the repository root:

```sh
pnpm deploy:devnet -- \
  --deployer .local/devnet-deployer.json \
  --program-keypair .local/cc-token-program.json \
  --buffer .local/devnet-buffer.json
```

For an initial deployment, repeat the reviewed command with `--execute`:

```sh
pnpm deploy:devnet -- \
  --deployer .local/devnet-deployer.json \
  --program-keypair .local/cc-token-program.json \
  --buffer .local/devnet-buffer.json \
  --execute
```

For an upgrade, the program keypair is unnecessary. The deployer must be the current upgrade
authority:

```sh
pnpm deploy:devnet -- \
  --deployer .local/devnet-upgrade-authority.json \
  --buffer .local/devnet-buffer.json \
  --execute
```

Set `CC_TOKEN_DEVNET_RPC_URL` or pass `--rpc-url` for a dedicated devnet provider. Every endpoint
must return the canonical devnet genesis hash. RPC paths and query strings are redacted in output so
provider credentials are not written to logs.

Successful deployments write an ignored receipt under `target/deployments/devnet/`. It contains
the Git commit and working-tree state, artifact hash, program ID, public authority, deployment
result and confirmed on-chain metadata. Public deployment records contain only the reproducibility
and discovery fields needed by integrators.

## Verification and interrupted uploads

The Solana CLI deploys through the upgradeable loader and may use many transactions for this
program. If an upload is interrupted, retain the buffer keypair and inspect loader buffers before
retrying. Do not close a buffer until its recovery value is understood.

For a public release, reproduce the deployed artifact from the exact public commit and verify the
on-chain bytecode. Anchor supports Docker-based verifiable builds and `anchor verify`; the current
devnet setup records the ordinary pinned-build hash but does not claim a verifiable build. Source
verification proves correspondence to source, not protocol security.

References:

- [Solana program deployment](https://solana.com/docs/programs/deploying)
- [Solana production readiness](https://solana.com/docs/tools/production-readiness)
- [Solana clusters and public RPC endpoints](https://solana.com/docs/references/clusters)
- [Anchor verifiable builds](https://www.anchor-lang.com/docs/references/verifiable-builds)
