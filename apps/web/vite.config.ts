import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // The Codama-generated client reads process.env.NODE_ENV, which browsers do not define.
  define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  plugins: [react(), tailwindcss()],
}));
