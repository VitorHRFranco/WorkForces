import { expect, test, type Page } from "@playwright/test";
import { Appearance, appearanceKey, type AppBridge } from "@workforces/protocol";
import { deskSpot, startOffice, walkTo, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

type HookWindow = { __workforces: { appearanceKeyOf(name: string): string | null } };
type BridgeWindow = { workforces: AppBridge };

/** O `appearanceKey` do que a cena dessa página mostra para a pessoa. */
function keyOf(page: Page, name: string): Promise<string | null> {
  return page.evaluate((who) => (window as unknown as HookWindow).__workforces.appearanceKeyOf(who), name);
}

/** O personagem guardado no perfil do app dessa página. */
function profileOf(page: Page): Promise<Appearance | null> {
  return page.evaluate(() => (window as unknown as BridgeWindow).workforces.appearance.get());
}

test("primeira vez: o Personalizar abre antes da tela inicial e grava o personagem", async () => {
  const { app, page } = await office.launchApp({ profile: null });
  await expect(page.getByRole("heading", { name: "Seu personagem" })).toBeVisible();
  await page.getByRole("button", { name: "Pronto" }).click();
  await expect(page.getByRole("heading", { name: "WorkForces" })).toBeVisible();
  expect(Appearance.safeParse(await profileOf(page)).success).toBe(true);
  await office.closeApp(app);
});

test("primeira vez pelo convite: depois do Pronto, a página do convite", async () => {
  const admin = await office.account("admin-convite");
  const link = await office.inviteAppLink(admin);
  const { app, page } = await office.launchApp({ profile: null, link });
  await expect(page.getByRole("heading", { name: "Seu personagem" })).toBeVisible();
  await page.getByRole("button", { name: "Pronto" }).click();
  await expect(page.getByRole("heading", { name: /^Criar sua conta em / })).toBeVisible({ timeout: 30_000 });
  await office.closeApp(app);
});

test("no escritório: Personalizar troca o personagem para todos, e Cancelar não muda nada", async () => {
  const ana = await office.account("ana");
  const bia = await office.account("bia");
  const anaPage = await office.login(ana);
  const biaPage = await office.login(bia);
  await expect.poll(() => keyOf(biaPage, "ana")).toBeTruthy();

  // Corpo Masculino, penteado Topete, camisa em cor livre e gravata.
  await anaPage.getByRole("button", { name: "Personalizar" }).click();
  const dialog = anaPage.getByRole("dialog", { name: "Personalizar" });
  await dialog.getByRole("radio", { name: "Masculino" }).check();
  await dialog.getByRole("combobox", { name: "Penteado" }).selectOption({ label: "Topete" });
  await dialog.getByLabel("Outra cor: Camisa").fill("#3a7d44");
  await dialog.getByRole("checkbox", { name: "Gravata" }).check();
  await dialog.getByRole("button", { name: "Pronto" }).click();
  await expect(dialog).toBeHidden();

  const saved = await profileOf(anaPage);
  expect(saved).toMatchObject({ body: "masculine", hair: { style: "short-04" }, top: { color: "#3a7d44" } });
  expect(saved!.bowtie).not.toBeNull();
  await expect.poll(() => keyOf(biaPage, "ana")).toBe(appearanceKey(saved!));

  // Cancelar: abre, troca o penteado, captura a tela e cancela; nada muda para bia nem no perfil.
  await anaPage.getByRole("button", { name: "Personalizar" }).click();
  await dialog.getByRole("combobox", { name: "Penteado" }).selectOption({ label: "Raspado" });
  await anaPage.waitForTimeout(500); // a prévia remonta com o penteado novo antes da captura
  await anaPage.screenshot({ path: "test-results/personalizar.png" });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await profileOf(anaPage)).toEqual(saved);
  expect(await keyOf(biaPage, "ana")).toBe(appearanceKey(saved!));

  // A camisa em cor livre, de frente, na tela de bia (ana perto da mesa-2; bia na entrada).
  const desk = deskSpot(office.map, "mesa-2");
  await walkTo(anaPage, desk);
  await walkTo(anaPage, { x: desk.x, y: desk.y + 32 });
  await biaPage.waitForTimeout(1_500);
  await biaPage.screenshot({ path: "test-results/personagem-livre.png" });
});
