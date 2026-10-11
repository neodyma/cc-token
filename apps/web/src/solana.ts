import { createClient } from "@solana/kit";
import { solanaDevnetRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

export const CLUSTER = { name: "devnet", chain: "solana:devnet" } as const;

const publicRpcUrl: string = import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpcProxyEnabled = import.meta.env.VITE_SOLANA_RPC_PROXY_ENABLED === "true";
const rpcUrl = rpcProxyEnabled
  ? new URL("/api/rpc", window.location.origin).toString()
  : publicRpcUrl;

// Version 0 is the compatibility baseline; version 1 stays an optional improvement.
export const client = createClient()
  .use(walletSigner({ chain: CLUSTER.chain }))
  .use(
    solanaDevnetRpc({
      rpcUrl,
      // Vercel Functions proxy HTTP only. Keep subscriptions on the public devnet socket.
      ...(rpcProxyEnabled ? { rpcSubscriptionsUrl: "wss://api.devnet.solana.com" } : undefined),
      transactionConfig: { version: 0 },
    }),
  );

export type AppClient = typeof client;
