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
/** A primeira verificação de atualização sai 10 s depois de a janela abrir (FIRST_CHECK_MS do app); a ida aos Releases leva o resto. */
const UPDATE_CHECK_MS = 120_000;
/** O fim de uma verificação no log do app (update.ts), com sucesso ou com falha. */
const CHECK_DONE = /^atualização: verificação (terminou|falhou)/;

test.skip(!EXE, "só roda com WF_PACKAGED_EXE apontando para o app instalado");

/** O app aberto, se ainda estiver: o `afterEach` fecha, e uma falha mostra a tela e o console dele. */
let opened: { app: ElectronApplication; page: Page; log: string[] } | undefined;
const dirs: string[] = [];

test.afterEach(async ({}, testInfo) => {
  if (!opened) return;
  // Este E2E só roda no CI: sem isto, uma falha diria qual elemento faltou, e não o aviso que a tela mostrou no lugar.
  if (testInfo.status !== testInfo.expectedStatus) {
    const screen = await opened.page.locator("body").innerText({ timeout: 2_000 }).catch(() => "(a tela não respondeu)");
    console.log(`tela do app instalado na falha:${EOL}${screen}${EOL}console do app:${EOL}${opened.log.join(EOL)}`);
  }
  // O próximo teste abre o app de novo: este não pode ficar rodando.
  await closeApp(opened.app);
  opened = undefined;
});
test.afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** As pastas do PATH com e sem um node.exe; as sem ficam para o app (ele chama o powershell.exe, que mora no System32). */
function splitPath(path: string): { withNode: string[]; rest: string[] } {
  const entries = path.split(delimiter).filter((entry) => entry !== "");
  const hasNode = (entry: string): boolean => existsSync(join(entry.replace(/"/g, ""), "node.exe"));
  return { withNode: entries.filter(hasNode), rest: entries.filter((entry) => !hasNode(entry)) };
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
  dirs.push(root);
  const runtimeDir = join(root, "runtime");
  // O Node que roda o teste está no PATH: sem nenhuma pasta para tirar, o teste não provaria nada.
  const path = splitPath(process.env.PATH ?? "");
  expect(path.withNode).not.toHaveLength(0);
  const env = { PATH: path.rest.join(delimiter), WF_RUNTIME_DIR: runtimeDir, WF_NO_UPDATE: "1" };
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

test("o app instalado, com a atualização ligada, verifica os Releases e continua de pé", async () => {
  // A primeira abertura copia o runtime antes da janela, e a primeira verificação sai 10 s depois dela.
  test.setTimeout(240_000);
  // Sem WF_NO_UPDATE o `autoUpdater` de verdade nasce e vai aos Releases do GitHub. O teste não clica em "Reiniciar agora"
  // (com um release mais novo que a versão do branch, o app baixaria em segundo plano).
  expect(process.env.WF_NO_UPDATE, "o teste precisa da atualização ligada").toBeUndefined();
  const root = mkdtempSync(join(tmpdir(), "wf-e2e-atualizacao-"));
  dirs.push(root);
  const { app, page } = await withEnv({ WF_RUNTIME_DIR: join(root, "runtime") }, () => launchApp(root, { executablePath: EXE! }));
  const log: string[] = [];
  const updateLog: string[] = [];
  let result: string | undefined;
  app.on("console", (message) => {
    const text = message.text();
    log.push(text);
    if (log.length > LOG_KEEP) log.shift();
    // As linhas do app (update.ts) e as do electron-updater, que escreve no console do processo principal.
    if (/atualiza|update/i.test(text)) updateLog.push(text);
    if (result === undefined && CHECK_DONE.test(text)) result = text;
  });
  opened = { app, page, log };

  // 1. A tela inicial abre normalmente.
  const create = page.getByRole("button", { name: "Criar escritório" });
  await expect(create).toBeVisible();

  // 2. A primeira verificação termina (sem release publicado, falha; com o da mesma versão, não acha nada novo) e só vai ao log.
  await expect.poll(() => result, { timeout: UPDATE_CHECK_MS, message: "a primeira verificação de atualização não terminou" }).toBeDefined();
  console.log(`verificação de atualização no app instalado:${EOL}${updateLog.join(EOL)}`);
  expect(updateLog).toContain("atualização: verificando os Releases");

  // 3. O app continua de pé: o processo principal e a janela respondem.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole("heading", { name: "Escritório neste computador" })).toBeVisible();

  // 4. E fecha sozinho, sem precisar ser morto.
  opened = undefined;
  expect(await closeApp(app)).toBe(true);
});
