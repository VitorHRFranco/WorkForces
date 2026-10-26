import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { deskSpot, startOffice, walkTo, type Office } from "../test/support/office.js";

/** Os quadros vão para packages/e2e/demo-frames; tools/demo/make_gif.py monta o GIF a partir deles. */
const FRAMES = fileURLToPath(new URL("../demo-frames", import.meta.url));
const DEMO_AGENT = fileURLToPath(new URL("./demo-agent.mjs", import.meta.url));
/** Um quadro a cada 4 que o navegador desenha (~15 por segundo): fluido sem pesar no GIF. */
const EVERY_NTH_FRAME = 4;

let office: Office;
test.beforeAll(async () => {
  office = await startOffice();
});
test.afterAll(async () => {
  await office?.stop();
});

test("grava a demonstração do README", async ({ browser }) => {
  const ana = await office.account("ana");
  const bia = await office.account("bia");
  const anaPage = await office.login(browser, ana);
  const biaPage = await office.login(browser, bia);
  await office.startAgent(bia, DEMO_AGENT);
  await anaPage.waitForTimeout(3_000); // o robô da bia aparece e começa a trabalhar

  const recorder = await record(anaPage);
  await anaPage.waitForTimeout(1_000);
  await walkTo(anaPage, deskSpot(office.map, "mesa-2"));
  await expect(anaPage.getByRole("region", { name: "Terminal da mesa" })).toBeVisible();
  await anaPage.waitForTimeout(7_000);
  // Enter abre o chat (o painel cobre parte da caixa: clicar nela não daria).
  await anaPage.keyboard.press("Enter");
  await anaPage.keyboard.type("que legal, bia!", { delay: 70 });
  await anaPage.keyboard.press("Enter");
  await biaPage.getByRole("textbox", { name: "Mensagem" }).fill("valeu! já já sobe o frete");
  await biaPage.getByRole("textbox", { name: "Mensagem" }).press("Enter");
  await anaPage.waitForTimeout(2_500);
  const count = await recorder.stop();
  console.log(`${count} quadros em ${FRAMES}`);
});

/**
 * Grava a página pelo screencast do Chromium (quadros mandados pelo próprio navegador, com a hora de cada um) até
 * `stop()`; timing.json guarda quanto cada quadro dura.
 */
async function record(page: Page) {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const taken: { file: string; at: number }[] = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${String(taken.length).padStart(4, "0")}.png`;
    writeFileSync(join(FRAMES, file), Buffer.from(data, "base64"));
    taken.push({ file, at: (metadata.timestamp ?? Date.now() / 1000) * 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: EVERY_NTH_FRAME });
  return {
    async stop(): Promise<number> {
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
      const timing = taken.map((frame, i) => ({ file: frame.file, ms: Math.round(i + 1 < taken.length ? taken[i + 1]!.at - frame.at : 100) }));
      writeFileSync(join(FRAMES, "timing.json"), JSON.stringify(timing));
      return taken.length;
    },
  };
}
