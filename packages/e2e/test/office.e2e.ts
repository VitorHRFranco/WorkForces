import { expect, test } from "@playwright/test";
import { FAKE_TOKEN, deskSpot, startOffice, walkTo, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

test("A visita a mesa de B: vê o terminal com o token mascarado, conversa no chat, respeita a mesa fechada e sai da zona", async ({ browser }) => {
  const ana = await office.account("ana");
  const bia = await office.account("bia");
  // Quem aparece primeiro fica com a primeira mesa livre: ana na mesa-1, bia na mesa-2.
  const anaPage = await office.login(browser, ana);
  const biaPage = await office.login(browser, bia);
  await office.startAgent(bia);

  const panel = anaPage.getByRole("region", { name: "Terminal da mesa" });
  const screen = panel.locator(".xterm-rows");
  await walkTo(anaPage, deskSpot(office.map, "mesa-2"));
  await expect(panel).toBeVisible();
  await expect(screen).toContainText("agente de brinquedo");
  await expect(screen).toContainText("token de teste: ••••");
  await expect(screen).not.toContainText("E2Etokendebrinquedo");
  expect(await screen.textContent()).not.toContain(FAKE_TOKEN);
  // Nem pela rede: o que chega ao navegador já vem mascarado da ponte.
  const toAna = () => office.messagesFor(anaPage);
  expect(toAna().some((message) => message.includes("token de teste"))).toBe(true);
  expect(toAna().some((message) => message.includes("E2Etokendebrinquedo"))).toBe(false);

  const anaChat = anaPage.getByRole("region", { name: "Chat" });
  const biaChat = biaPage.getByRole("region", { name: "Chat" });
  await anaPage.getByRole("textbox", { name: "Mensagem" }).fill("oi, bia! vi seu agente");
  await anaPage.getByRole("textbox", { name: "Mensagem" }).press("Enter");
  await expect(biaChat).toContainText("oi, bia! vi seu agente");
  await biaPage.getByRole("textbox", { name: "Mensagem" }).fill("oi, ana!");
  await biaPage.getByRole("textbox", { name: "Mensagem" }).press("Enter");
  await expect(anaChat).toContainText("oi, ana!");

  // Mesa fechada: o painel some para quem visita, e volta quando a dona abre.
  await biaPage.getByRole("button", { name: "Mesa: aberta" }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => toAna().some((message) => message.includes('"desk-closed"'))).toBe(true);
  await expect(biaPage.getByRole("button", { name: "Mesa: fechada" })).toBeVisible();
  await biaPage.getByRole("button", { name: "Mesa: fechada" }).click();
  await expect(panel).toBeVisible();
  await expect(screen).toContainText("token de teste: ••••");

  // Saindo da zona, o painel fecha.
  await anaPage.getByRole("textbox", { name: "Mensagem" }).press("Escape"); // Esc devolve as setas ao jogo
  await walkTo(anaPage, office.map.spawn, ["y", "x"]);
  await expect(panel).toBeHidden();
});
