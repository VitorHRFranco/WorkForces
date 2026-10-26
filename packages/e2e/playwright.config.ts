import { defineConfig, devices } from "@playwright/test";

// Os testes sobem o servidor e a ponte do build (`pnpm build` antes): cada arquivo cuida dos próprios processos.
export default defineConfig({
  testDir: "test",
  testMatch: "*.e2e.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    // Janela pequena: o jogo é desenhado por software no navegador sem GPU, e cada página pesa na CPU.
    viewport: { width: 960, height: 640 },
    // O trace grava capturas de cada passo das duas páginas: só no CI, onde o relatório de falha é o que sobra.
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
});
