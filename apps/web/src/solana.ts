import { createClient } from "@solana/kit";
import { solanaDevnetRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

export const CLUSTER = { name: "devnet", chain: "solana:devnet" } as const;

const rpcUrl: string = import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// Version 0 is the compatibility baseline; version 1 stays an optional improvement.
export const client = createClient()
  .use(walletSigner({ chain: CLUSTER.chain }))
  .use(solanaDevnetRpc({ rpcUrl, transactionConfig: { version: 0 } }));

export type AppClient = typeof client;
