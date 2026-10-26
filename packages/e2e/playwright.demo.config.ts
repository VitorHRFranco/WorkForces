import { defineConfig, devices } from "@playwright/test";

// Grava os quadros do GIF do README (`pnpm demo` na raiz); não roda com os testes nem no CI.
export default defineConfig({
  testDir: "demo",
  testMatch: "*.capture.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    // Larga o bastante para o mapa aparecer ao lado do painel do terminal (760 px).
    viewport: { width: 1280, height: 720 },
    trace: "off",
  },
});
