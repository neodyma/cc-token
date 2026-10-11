import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  const rpcProxyEnabled = command === "build" && Boolean(process.env.SOLANA_RPC_URL?.trim());

  return {
    // The Codama-generated client reads process.env.NODE_ENV, which browsers do not define.
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
      "import.meta.env.VITE_SOLANA_RPC_PROXY_ENABLED": JSON.stringify(
        rpcProxyEnabled ? "true" : "false",
      ),
    },
    plugins: [react(), tailwindcss()],
  };
});
