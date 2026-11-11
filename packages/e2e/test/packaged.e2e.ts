import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { EOL, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { PASSWORD, closeApp, freePort, launchApp } from "./support/office.js";

/** O WorkForces.exe instalado pelo CI do instalador (package.yml). Sem ele, o teste não roda (o E2E do Linux continua igual). */
const EXE = process.env.WF_PACKAGED_EXE;
/** Ligar sobe o servidor no Node que o app traz, e ele tem até 20 s para dizer que subiu. */
const START_MS = 30_000;
/** Quanto uma tela que depende do escritório (a barra de cima) pode levar: o jogo é desenhado por software. */
const PAGE_MS = 30_000;
/** Depois de o app sair, quanto a porta pode levar para ficar livre. */
const PORT_FREE_MS = 10_000;
/** Quantas linhas do console do processo principal ficam guardadas para o log de uma falha. */
const LOG_KEEP = 200;

test.skip(!EXE, "só roda com WF_PACKAGED_EXE apontando para o app instalado");

/** O app aberto, se ainda estiver: o `afterAll` fecha, e uma falha mostra a tela e o console dele. */
let opened: { app: ElectronApplication; page: Page; log: string[] } | undefined;
let dir: string | undefined;

test.afterEach(async ({}, testInfo) => {
  // Este E2E só roda no CI: sem isto, uma falha diria qual elemento faltou, e não o aviso que a tela mostrou no lugar.
  if (testInfo.status === testInfo.expectedStatus || !opened) return;
  const screen = await opened.page.locator("body").innerText({ timeout: 2_000 }).catch(() => "(a tela não respondeu)");
  console.log(`tela do app instalado na falha:${EOL}${screen}${EOL}console do app:${EOL}${opened.log.join(EOL)}`);
});
test.afterAll(async () => {
  if (opened) await closeApp(opened.app);
  opened = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** O PATH sem nenhuma pasta que tenha um node.exe; o resto fica (o app chama o powershell.exe, que mora no System32). */
function pathWithoutNode(path: string): string {
  return path
    .split(delimiter)
    .filter((entry) => entry !== "" && !existsSync(join(entry.replace(/"/g, ""), "node.exe")))
    .join(delimiter);
}

/**
 * Troca variáveis do ambiente do teste enquanto `run` roda e depois devolve as de antes. O `launchApp` copia o ambiente ao
 * abrir o app; no Windows, `process.env.PATH` também troca o `Path` (lá o nome não diferencia maiúsculas).
 */
async function withEnv<T>(vars: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, vars);
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Alguém atende em 127.0.0.1 nessa porta? Sem resposta no prazo conta como "atende": só a recusa prova a porta livre. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(2_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

test("o app instalado cria o escritório com o Node que traz, sem Node no PATH, e sair solta a porta", async () => {
  // A primeira abertura copia o runtime antes da janela, e o servidor sobe depois: mais que o prazo padrão de um teste.
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), "wf-e2e-instalado-"));
  dir = root;
  const runtimeDir = join(root, "runtime");
  const env = { PATH: pathWithoutNode(process.env.PATH ?? ""), WF_RUNTIME_DIR: runtimeDir, WF_NO_UPDATE: "1" };
  const { app, page } = await withEnv(env, () => launchApp(root, { executablePath: EXE! }));
  const log: string[] = [];
  app.on("console", (message) => {
    log.push(message.text());
    if (log.length > LOG_KEEP) log.shift();
  });
  opened = { app, page, log };

  // 1. A tela inicial.
  const create = page.getByRole("button", { name: "Criar escritório" });
  await expect(create).toBeVisible();

  // 2. Criar: Hospedar LAN, na porta sondada. O servidor sobe no node.exe que o app copiou para o WF_RUNTIME_DIR.
  const port = await freePort();
  await create.click();
  await expect(page.getByRole("heading", { name: "Escritório neste computador" })).toBeVisible();
  await page.getByRole("radio", { name: /Hospedar LAN/ }).check();
  await page.getByRole("spinbutton", { name: "Porta" }).fill(String(port));
  await page.getByRole("button", { name: "Criar e entrar" }).click();
  await expect(page.getByRole("heading", { name: `Criar sua conta em 127.0.0.1:${port}` })).toBeVisible({ timeout: START_MS });

  // 3. A primeira conta, e o escritório abre com ela.
  await page.getByRole("textbox", { name: /^Nome/ }).fill("ana");
  await page.getByRole("textbox", { name: /^Senha/ }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "Repita a senha" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta e entrar" }).click();
  await expect(page.locator(".topbar .who")).toHaveText("ana", { timeout: PAGE_MS });

  // 4. O Node do app ficou no runtime copiado, fora da pasta de instalação.
  const nodes = readdirSync(runtimeDir).filter((name) => /^node-[\d.]+$/.test(name));
  expect(nodes).toHaveLength(1);
  expect(existsSync(join(runtimeDir, nodes[0]!, "node.exe"))).toBe(true);

  // 5. Sair desliga o escritório, e nenhum processo dele fica segurando a porta.
  expect(await answers(port)).toBe(true);
  opened = undefined;
  await closeApp(app);
  await expect.poll(() => answers(port), { timeout: PORT_FREE_MS }).toBe(false);
});
