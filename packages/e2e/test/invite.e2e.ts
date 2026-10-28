import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PASSWORD, startOffice, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

test("o convite abre o app na criação da conta, entra no escritório e continua logado ao reabrir", async () => {
  const ana = await office.account("ana");
  const link = await office.inviteAppLink(ana);
  const first = await office.launchApp({ link });
  await expect(first.page.getByRole("heading", { name: `Criar sua conta em ${office.host}` })).toBeVisible();
  // A página não enxerga o Node (sandbox e isolamento de contexto): só o `window.workforces` do preload.
  expect(await first.page.evaluate(() => [typeof require, typeof process])).toEqual(["undefined", "undefined"]);
  await first.page.getByRole("textbox", { name: /^Nome/ }).fill("caio");
  await first.page.getByRole("textbox", { name: /^Senha/ }).fill(PASSWORD);
  await first.page.getByRole("textbox", { name: "Repita a senha" }).fill(PASSWORD);
  await first.page.getByRole("button", { name: "Criar conta e entrar" }).click();
  await first.page.waitForFunction(() => "__workforces" in window);
  await expect(first.page.locator(".topbar .who")).toHaveText("caio");

  // O perfil guarda a sessão cifrada pelo safeStorage, nunca o valor que o servidor deu (43 caracteres em base64url).
  const profile = JSON.parse(readFileSync(join(first.dataDir, "offices.json"), "utf8")) as { offices: { session: unknown }[] };
  expect(profile.offices).toHaveLength(1);
  const sealed = profile.offices[0]!.session;
  if (typeof sealed !== "string") throw new Error(`a sessão não foi guardada: ${JSON.stringify(sealed)}`);
  expect(sealed.length).toBeGreaterThan(43);
  const session = await first.app.evaluate(({ safeStorage }, value) => safeStorage.decryptString(Buffer.from(value, "base64")), sealed);
  expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(sealed).not.toContain(session);

  // Fechar a janela só a esconde: o app continua rodando na bandeja.
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.isVisible()))).toEqual([false]);
  const child = first.app.process();
  expect(child.exitCode).toBeNull();
  // Com a janela escondida, sair pelo app (app.quit) ainda encerra o processo, sem precisar matá-lo.
  await office.closeApp(first.app);
  expect(child.signalCode).toBeNull();

  const again = await office.launchApp({ dataDir: first.dataDir });
  await again.page.waitForFunction(() => "__workforces" in window);
  await expect(again.page.locator(".topbar .who")).toHaveText("caio");
});
