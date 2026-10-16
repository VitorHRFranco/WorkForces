import preact from "@preact/preset-vite";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  // Lê o protocolo direto do código-fonte, como o resto do monorepo.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4600",
      "/ws": { target: "ws://127.0.0.1:4600", ws: true },
    },
  },
});
