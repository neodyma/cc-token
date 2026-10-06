# Identity layer runtime evidence

Measurements use the SBPF v3 program built with Solana 4.3.0 and executed by LiteSVM 0.16.0 with the Agave 4.2.1 runtime. They are regression evidence, not a cluster-wide compute guarantee.

| Operation                               | Compute units |
| --------------------------------------- | ------------: |
| Prepare a new condition                 |        13,349 |
| Reuse an existing condition             |        10,797 |
| Register an atomic collection           |        13,585 |
| Register a nested collection            |        17,889 |
| Reach an existing collection by reorder |        15,132 |

The recorded atomic and nested fixtures each found a valid BN254 x-coordinate after one hash-to-curve attempt. The tests print current compute use and retry counts so changes remain visible.

The local-validator suite also executes condition preparation and BN254 collection registration in version 0 transactions, then executes another collection registration through the optional version 1 path.
