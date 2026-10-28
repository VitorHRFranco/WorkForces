import { defineConfig } from "@playwright/test";

// Os testes sobem o servidor, a ponte e o app (Electron) do build (`pnpm build` antes): cada arquivo cuida dos próprios
// processos. O Electron não usa os fixtures de navegador (devices, viewport, trace); o tamanho da janela vem do harness.
export default defineConfig({
  testDir: "test",
  testMatch: "*.e2e.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
