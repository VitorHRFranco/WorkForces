import preact from "@preact/preset-vite";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  // Lê o protocolo direto do código-fonte, como o resto do monorepo.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  // O Phaser sozinho passa de 1 MB minificado; não é um problema para o escritório.
  build: { chunkSizeWarningLimit: 2500 },
});
