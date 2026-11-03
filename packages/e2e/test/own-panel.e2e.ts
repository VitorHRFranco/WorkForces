import { expect, test } from "@playwright/test";
import { startOffice, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

// O app acha o agente pelo canal local, como faria com um que ele mesmo abriu: o harness e o app rodam com o mesmo
// usuário e listam a mesma pasta de canais. A digitação vai pelo canal, sem passar pelo escritório.
test("o dono vê o próprio agente em Meus agentes e digita nele pelo app", async () => {
  const bia = await office.account("bia");
  const page = await office.login(bia);
  await office.startAgent(bia);
  await page.getByRole("button", { name: "Meus agentes" }).click();
  const panel = page.getByRole("region", { name: "Meus agentes" });
  await expect(panel).toContainText("agente de brinquedo");
  await expect(panel).toContainText("token de teste: ••••");
  await panel.locator(".xterm").click();
  await page.keyboard.type("oi");
  await page.keyboard.press("Enter");
  await expect(panel).toContainText("recebi: oi");
});
