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
  await first.page.getByRole("textbox", { name: /^Nome/ }).fill("caio");
  await first.page.getByRole("textbox", { name: /^Senha/ }).fill(PASSWORD);
  await first.page.getByRole("textbox", { name: "Repita a senha" }).fill(PASSWORD);
  await first.page.getByRole("button", { name: "Criar conta e entrar" }).click();
  await first.page.waitForFunction(() => "__workforces" in window);
  await expect(first.page.locator(".topbar .who")).toHaveText("caio");
  await office.closeApp(first.app);

  const again = await office.launchApp({ dataDir: first.dataDir });
  await again.page.waitForFunction(() => "__workforces" in window);
  await expect(again.page.locator(".topbar .who")).toHaveText("caio");
});
