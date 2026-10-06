# Examples

## 1. Refine a SOL price-range claim

Maya makes markets in SOL derivatives. One oracle condition defines SOL/USD at 16:00 UTC on 31 December 2026 using 16 configured price buckets.

She deposits 10,000 USDC and receives:

| Position                            | Shares | Redemption per share |
| ----------------------------------- | -----: | -------------------- |
| SOL is at least $125 and below $200 | 10,000 | 1 USDC if true       |
| SOL is outside that range           | 10,000 | 1 USDC if true       |

The two positions are backed by the original 10,000 USDC.

Customers later want narrower exposure. Maya splits the first position into:

| Position                            | Shares |
| ----------------------------------- | -----: |
| SOL is at least $125 and below $150 | 10,000 |
| SOL is at least $150 and below $175 | 10,000 |
| SOL is at least $175 and below $200 | 10,000 |

No additional collateral or oracle question is needed. Maya can sell the middle range and retain the other positions.

If SOL settles at $162, the middle position redeems for 10,000 USDC. All other positions pay zero. Before settlement, a holder can merge equal quantities of the three narrower claims back into the broad range.

This lets users reshape existing claims without creating separate markets for every range. The [MetaDAO split implementation](https://github.com/metaDAOproject/programs/blob/develop/programs/conditional_vault/src/instructions/split_tokens.rs) and [WAGR specification](https://github.com/wagr-labs/wagr/blob/main/docs/outcome-spec.md) issue complete outcome sets and do not expose a refinement operation like this.

[Polymarket V2](https://github.com/Polymarket/polymarket-v2-external/blob/main/docs/modules.md) supports combinations, refinement and complements. CC-Token supports generic partitioning for arbitrary subsets of a condition with N outcomes.

## 2. Trade ABC under governance and price conditions

ABC DAO launches a proposal to allocate $10 million to token buybacks. A market maker deposits 50,000 ABC and creates four positions using the proposal result and SOL/USD at a specified expiry:

| Position                               | Shares |
| -------------------------------------- | -----: |
| Buyback approved and SOL at least $200 | 50,000 |
| Buyback approved and SOL below $200    | 50,000 |
| Buyback rejected and SOL at least $200 | 50,000 |
| Buyback rejected and SOL below $200    | 50,000 |

Exactly one position redeems for 50,000 ABC, the others pay zero.

Another user creates USDC-backed claims for the same outcomes. 3500 USDC claims are offered in exchange for 5000 ABC claims, with both being payable iff the buyback is approved and SOL is at least $200.

In this scenario, ABC is effectively priced at 0.70 USDC.

The order of positions does not matter here. Adding the governance condition first and then the SOL price condition or doing it in reverse results in the same fungible position and use the same wrapped SPL token mint address or trading pool.

## 3. Back an RPC performance bond with repeated payout factors

Northstar RPC deposits 10000 USDC as an uptime bond. A monitoring oracle reports mothly downtime as a fraction of 24 hours (max 100%).

The contract pays the customer:

```text
10000 USDC × downtime fraction × downtime fraction
```

| Monthly downtime | Downtime fraction |     Payout |
| ---------------- | ----------------: | ---------: |
| 0 hours          |                0% |     0 USDC |
| 6 hours          |               25% |   625 USDC |
| 12 hours         |               50% |  2500 USDC |
| 24 hours or more |              100% | 10000 USDC |

Northstar splits the collateral into a downtime claim and its completemt. Then, the downtime claim is split again with the same condition. The customer receives the position containing the downtime factor twice, and Northstar retains the complementary positions.

For six hours of downtime, redemption takes two steps:

```text
10000 double-factor shares * 1/4 * 1/4
    → 2500 single-factor shares * 1/4
    → 625 USDC
```

Northstars complementary positions redeem for 9375 USDC.

With this, nonlinear payouts are possible.
