import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startOffice, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

/** O que o app já gravou no log da pasta de dados dele ("" enquanto o arquivo não existe). */
function readLog(dataDir: string): string {
  try {
    return readFileSync(join(dataDir, "logs", "app.log"), "utf8");
  } catch {
    return "";
  }
}

// O app instalado só escrevia no console do processo principal; agora grava um arquivo que a pessoa pode anexar a um issue (#25).
test("o app grava o log em arquivo com a linha de abertura, e um erro da página entra nele sem o token", async () => {
  const { page, dataDir } = await office.launchApp();

  await expect.poll(() => readLog(dataDir)).toContain("WorkForces 0.1.0 · Electron");

  // O ouvinte de erros da página nasce com o script dela: o erro de teste só vale depois de a tela inicial aparecer.
  await expect(page.getByRole("button", { name: "Criar escritório" })).toBeVisible();

  const token = "wf_" + "a".repeat(30);
  await page.evaluate((secret) => {
    setTimeout(() => {
      throw new Error(`erro de teste do E2E ${secret}`);
    });
  }, token);

  await expect.poll(() => readLog(dataDir)).toContain("erro de teste do E2E");
  const log = readLog(dataDir);
  expect(log).toContain("erro [página]");
  expect(log).not.toContain(token);
  expect(log).not.toContain("wf_aaaa");
});
