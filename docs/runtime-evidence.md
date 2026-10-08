# Protocol runtime evidence

Measurements use the SBPF v3 program built with Solana 4.3.0 and executed by LiteSVM 0.16.0 with the Agave 4.2.1 runtime. They are regression evidence, not a cluster-wide compute guarantee.

| Operation                               | Compute units |
| --------------------------------------- | ------------: |
| Prepare a new condition                 |        13,349 |
| Reuse an existing condition             |        10,797 |
| Register an atomic collection           |        13,585 |
| Register a nested collection            |        17,889 |
| Reach an existing collection by reorder |        15,132 |
| Report four fractional payouts          |         4,956 |
| Report 256 maximum-width payouts        |        32,175 |
| Initialize a staged 256-outcome report  |        13,889 |
| Append the first 96 staged payouts      |        19,596 |
| Append the final 64 staged payouts      |        29,608 |
| Finalize a staged 256-outcome report    |        34,877 |
| Split collateral into 2 root positions  |        28,553 |
| Split collateral into 8 root positions  |        83,728 |
| Split collateral into 16 root positions |       154,693 |

The recorded atomic and nested fixtures each found a valid BN254 x-coordinate after one hash-to-curve attempt. The tests print current compute use and retry counts so changes remain visible.

The local-validator suite executes condition preparation and BN254 collection registration through version 0, then another collection registration through version 1. It also submits all 256 payout numerators atomically through version 1 and submits the same arity through version 0 using three append transactions before atomic finalization.

Root collateral split capacity was measured with every outcome represented by one position:

| Outputs | Accounts | Instruction data | Static transaction | v0 with lookup table |
| ------: | -------: | ---------------: | -----------------: | -------------------: |
|       2 |       12 |              116 |                651 |                  561 |
|       8 |       24 |              308 |              1,250 |                  778 |
|      16 |       40 |              564 |              2,034 |                1,066 |

Two outputs fit a version-0 transaction without a lookup table. Eight and sixteen outputs exceed the 1,232-byte packet limit with static addresses, but fit version 0 when the position and balance accounts are loaded from an address lookup table. Transaction v1 remains optional. All three operations are well below the 1.4M CU ceiling; current tests print the measured values because PDA bump search can change them across generated test accounts.
