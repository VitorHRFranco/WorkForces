import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pacotes do workspace são lidos direto do código-fonte (condição "source").
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
