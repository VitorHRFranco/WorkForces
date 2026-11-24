import { expect, test, type Page } from "@playwright/test";
import { LEGACY, appearanceKey, type AppBridge, type Appearance } from "@workforces/protocol";
import { deskSpot, startOffice, walkTo, type Office } from "./support/office.js";

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

/** A: uma das de hoje com outro cabelo. */
const A: Appearance = { ...LEGACY[0], hair: { style: "short-08", color: "Blonde" } };
/** B: corpo masculino com todas as peças opcionais, para conferir a ordem das camadas na captura; a camisa em cor livre. */
const B: Appearance = {
  ...LEGACY[0],
  body: "masculine",
  beard: "facial-06",
  brows: "brows-02",
  glasses: { style: "glasses-01", color: "Gold" },
  cardigan: "Navy",
  suspenders: "Leather",
  bowtie: "Red",
  top: { style: LEGACY[0].top.style, color: "#3a7d44" },
};
const LEGACY_KEYS = LEGACY.map((appearance) => appearanceKey(appearance));

type HookWindow = { __workforces: { appearanceKeyOf(name: string): string | null } };

/** O `appearanceKey` do que a cena dessa página mostra para a pessoa (null se ela não está na cena). */
function keyOf(page: Page, name: string): Promise<string | null> {
  return page.evaluate((who) => (window as unknown as HookWindow).__workforces.appearanceKeyOf(who), name);
}

/** `PUT /api/me/appearance` de dentro da página (o processo principal repassa com a sessão); devolve o status. */
function putAppearance(page: Page, appearance: unknown): Promise<number> {
  return page.evaluate(
    async (body) =>
      (await fetch("/api/me/appearance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status,
    appearance,
  );
}

test("a aparência do perfil chega aos outros ao entrar, troca na hora para todos, a inválida é recusada e quem entra depois a vê", async () => {
  const ana = await office.account("ana");
  const bia = await office.account("bia");
  const anaPage = await office.login(ana);
  const biaPage = await office.login(bia);

  // Sem perfil, cada uma vê a outra com uma das aparências de hoje.
  await expect.poll(() => keyOf(biaPage, "ana")).toBeTruthy();
  expect(LEGACY_KEYS).toContain(await keyOf(biaPage, "ana"));
  await expect.poll(() => keyOf(anaPage, "bia")).toBeTruthy();
  expect(LEGACY_KEYS).toContain(await keyOf(anaPage, "bia"));

  // ana guarda A só no perfil e recarrega: a página manda o perfil antes de abrir o socket, e bia passa a ver A.
  // O reload volta a app://workforces/office: o processo principal serve o index.html e o roteador abre o escritório de novo.
  await anaPage.evaluate((appearance) => (window as unknown as { workforces: AppBridge }).workforces.appearance.set(appearance), A);
  await anaPage.reload();
  await anaPage.waitForFunction(() => "__workforces" in window);
  await expect.poll(() => keyOf(biaPage, "ana")).toBe(appearanceKey(A));

  // A troca na hora: B vai pelo PUT, e bia e a própria ana a veem sem recarregar.
  expect(await putAppearance(anaPage, B)).toBe(204);
  await expect.poll(() => keyOf(biaPage, "ana")).toBe(appearanceKey(B));
  await expect.poll(() => keyOf(anaPage, "ana")).toBe(appearanceKey(B));

  // Barba no corpo feminino: o servidor recusa, e nada muda para bia.
  expect(await putAppearance(anaPage, { ...B, body: "feminine" })).toBe(400);
  expect(await keyOf(biaPage, "ana")).toBe(appearanceKey(B));

  // Quem entra depois: bia recarrega, e o welcome já traz ana com B.
  await biaPage.reload();
  await biaPage.waitForFunction(() => "__workforces" in window);
  await expect.poll(() => keyOf(biaPage, "ana")).toBe(appearanceKey(B));

  // ana vai até a mesa-2, para não ficar por cima de bia (na entrada); o CI guarda a captura (artefato "personagem").
  await walkTo(anaPage, deskSpot(office.map, "mesa-2"));
  // A cena de bia mostra ana com um pouco de atraso (a posição chega pelo servidor e é interpolada).
  await biaPage.waitForTimeout(1_500);
  await biaPage.screenshot({ path: "test-results/personagem.png" });
});
