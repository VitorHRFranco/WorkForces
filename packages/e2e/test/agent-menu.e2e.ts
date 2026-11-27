import { expect, test } from "@playwright/test";
import { startOffice, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

// Os outros E2E abrem o agente por fora (pelo harness); este clica no menu como uma pessoa (#24).
test("Chamar agente: sem pasta, o menu diz o que fazer, e Pastas… abre a janela por cima do escritório", async () => {
  const ana = await office.account("ana");
  const page = await office.login(ana);

  await page.getByRole("button", { name: "Chamar agente" }).click();
  await expect(page.getByText("Escolha uma pasta para abrir o Claude: libere uma em Pastas…")).toBeVisible();
  await page.getByRole("button", { name: "Pastas…" }).click();

  const dialog = page.getByRole("dialog", { name: "Pastas liberadas" });
  await expect(dialog).toBeVisible();
  // Clicar e digitar de verdade: o Playwright falha se outro elemento (o jogo) estiver por cima da janela.
  await dialog.getByRole("textbox", { name: "Apelido" }).click();
  // Com maiúscula, tecla por tecla: o campo já põe em minúsculas, como o apelido precisa ser.
  await dialog.getByRole("textbox", { name: "Apelido" }).pressSequentially("Meu-Projeto");
  await expect(dialog.getByRole("textbox", { name: "Apelido" })).toHaveValue("meu-projeto");
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(dialog).toBeHidden();
});
