# Protocol architecture

![cc-token architecture](assets/cc-token-architecture.svg)

cc-token separates reusable claim definitions from holder balances. Conditions define outcome
spaces and payouts. Collections compose condition subsets through BN254 point addition. Positions
bind one collection to one collateral mint. A holder owns shares through a separate balance PDA.
Scenario and wrapper accounts add discovery and token interoperability without changing claim
identity.

## Actors

| Actor            | Authority                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Payer            | Funds permissionless definition and balance accounts. Gains no authority over them.            |
| Holder           | Signs every split, merge, transfer, wrap, unwrap and redemption that consumes its value.       |
| Resolver         | Reports the final payout vector for its condition. Resolution is irreversible.                 |
| Scenario creator | Publishes an anchor position under a name and may rename that descriptor.                      |
| Recipient        | Receives native or wrapped positions. A native recipient does not need to sign or exist first. |

The program has no global administrator and no instruction lets a backend move holder funds.

## Accounts and identities

| Account or authority   | Address derivation                                        | Purpose                                                                                            |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CollateralConfig`     | `['collateral', mint]`                                    | Records the token program, decimals, vault and freeze-authority classification.                    |
| Vault authority        | `['vault', mint]`                                         | Data-less PDA that signs vault transfers.                                                          |
| Vault                  | Associated token account for the vault authority and mint | Holds collateral backing outstanding root positions.                                               |
| `Condition`            | `['condition', condition_id]`                             | Stores resolver, question ID, outcome count, status and final payout vector.                       |
| `CollectionDefinition` | `['collection', collection_id]`                           | Stores one verified parent, condition and index-set witness for a canonical BN254 collection ID.   |
| `PositionDefinition`   | `['position', position_id]`                               | Binds `hash(collateral_mint, collection_id)` to its collateral and collection.                     |
| `PositionBalance`      | `['balance', owner, position_id]`                         | Stores one holder's native share balance.                                                          |
| `ScenarioDefinition`   | `['scenario', creator, anchor_position_id]`               | Names a canonical anchor position for permissionless scenario discovery.                           |
| `PayoutReport`         | `['payout_report', condition_id]`                         | Temporarily accumulates a large payout vector before atomic finalization.                          |
| `WrapperConfig`        | `['wrapper', position_id]`                                | Binds a position to its canonical Token-2022 wrapper mint.                                         |
| Wrapper mint           | `['wrapper_mint', position_id]`                           | Token-2022 representation minted and burned one-for-one against native shares held by the wrapper. |

The all-zero collection ID is the collateral root and has no account. Collection registration
recomputes the BN254 point from the supplied witness. Position registration recomputes the position
hash. These checks make stored descriptions authenticated rather than advisory metadata.

## Instruction groups

| Group             | Instructions                                                                                                           | Main validation                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Setup             | `register_collateral`, `prepare_condition`, `register_collection`, `register_position`                                 | Canonical PDA and identity, supported mint policy, valid outcome subset, registered parent.                   |
| Discovery         | `register_scenario`, `update_scenario_name`                                                                            | Canonical anchor position; only the recorded creator may rename.                                              |
| Balance lifecycle | `initialize_balance`, `close_balance`                                                                                  | Canonical owner/position balance; closure requires a zero amount.                                             |
| Value movement    | `split_from_collateral`, `split_position`, `merge_positions`, `merge_to_collateral`                                    | Disjoint partition, full cover for vault movement, exact source and destination identities, sufficient value. |
| Transfer          | `transfer_position`, `batch_transfer_positions`                                                                        | Holder signature, distinct recipient, sufficient native balance, no duplicate batch entries.                  |
| Resolution        | `report_payouts`, `initialize_payout_report`, `append_payout_report`, `finalize_payout_report`, `cancel_payout_report` | Resolver signature, exact outcome count, nonzero checked denominator, unresolved condition.                   |
| Redemption        | `redeem_position`, `redeem_to_collateral`                                                                              | Resolved condition, authenticated factor, checked wide multiply-divide and one-step floor.                    |
| Token bridge      | `initialize_wrapper`, `wrap_position`, `unwrap_position`                                                               | Canonical position and wrapper mint; native and wrapped quantities move one-for-one.                          |

Root splits transfer collateral into the vault and credit every member of a full partition.
Intermediate splits consume one native parent position and credit each child. Merges perform the
inverse transitions. Redemption removes one resolved factor at a time and credits either a
residual position or the collateral token account.

## Discovery and client boundary

The SDK discovers scenarios by filtering program accounts for `ScenarioDefinition`. For each
descriptor it verifies the anchor `PositionDefinition`, walks the `CollectionDefinition` parent
chain and verifies every referenced `Condition`. The anchor's complete condition multiset defines
the scenario basis; its index sets describe the featured claim.

Wallet participation is computed separately. Native `PositionBalance` accounts are filtered by
owner, canonical Token-2022 wrappers are intersected with the wallet's token accounts, and the
resulting positions are matched against each scenario basis. A position on a shared subset may
therefore appear in more than one scenario.

Question wording, transaction planning, RPC pacing and display are client concerns. The program
stores question IDs and payout authority, while the client may recover human-readable wording from
transaction memos. The web RPC proxy forwards an allowlisted set of reads without exposing its
provider URL.

## External programs

- System Program creates program-owned accounts and mints.
- SPL Token and Token-2022 move collateral through the vault.
- Associated Token Program creates vault and wallet token accounts.
- Token-2022 provides the canonical wrapper mint and inline wrapper metadata.
- Memo Program publishes optional question descriptions from the client transaction.
- Metaplex Token Metadata names test collateral created by the web client.

Compression and an on-chain market maker are outside the deployed MVP. They must preserve the same
position IDs and backing invariant if added later.
