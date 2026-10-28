import { defineConfig } from "@playwright/test";

// Grava os quadros do GIF do README (`pnpm demo` na raiz); não roda com os testes nem no CI. A janela do app tem o
// tamanho que o readme.capture.ts pede.
export default defineConfig({
  testDir: "demo",
  testMatch: "*.capture.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
});
