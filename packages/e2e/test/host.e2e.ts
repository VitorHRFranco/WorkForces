import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { EOL, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { PASSWORD, closeApp, freePort, launchApp, type LaunchOptions, type LaunchedApp } from "./support/office.js";

/** Ligar sobe o servidor no Node do sistema, e ele tem até 20 s para dizer que subiu. */
const START_MS = 30_000;
/** Na WAN sem roteador: a busca UPnP desiste em ~5 s, e o servidor reinicia com o endereço da rede local. */
const WAN_MS = 20_000;
/** Depois de o app sair, quanto a porta pode levar para ficar livre. */
const PORT_FREE_MS = 10_000;
/** Quanto uma tela que depende do escritório (convite, barra de cima, mapa) pode levar: o jogo é desenhado por software. */
const PAGE_MS = 30_000;

/** Quantas linhas do console do processo principal de cada app ficam guardadas para o log de uma falha. */
const LOG_KEEP = 200;

/** Sem servidor do harness: o escritório é o que o app do anfitrião sobe. Cada app tem a pasta de dados dele aqui dentro. */
let dir: string | undefined;
/** Os apps abertos e quem usa cada um: o `afterAll` fecha os que sobrarem, e uma falha mostra a tela e o console deles. */
const opened = new Map<ElectronApplication, { who: string; page: Page; log: string[] }>();

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-e2e-host-"));
});
test.afterEach(async ({}, testInfo) => {
  // Este E2E só roda no CI: sem isto, uma falha diria qual elemento faltou, e não o aviso que a tela mostrou no lugar
  // (Node ausente, porta ocupada) nem o que o app e o servidor embutido escreveram.
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const { who, page, log } of opened.values()) {
    const screen = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "(a tela não respondeu)");
    console.log(`tela do ${who} na falha:${EOL}${screen}${EOL}console do ${who}:${EOL}${log.join(EOL)}`);
  }
});
test.afterAll(async () => {
  // Fechar o app do anfitrião também desliga o escritório dele.
  const apps = [...opened.keys()];
  opened.clear();
  await Promise.all(apps.map((app) => closeApp(app)));
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function openApp(who: string, options?: LaunchOptions): Promise<LaunchedApp> {
  const launched = await launchApp(dir!, options);
  const log: string[] = [];
  launched.app.on("console", (message) => {
    log.push(message.text());
    if (log.length > LOG_KEEP) log.shift();
  });
  opened.set(launched.app, { who, page: launched.page, log });
  return launched;
}

async function quitApp(app: ElectronApplication): Promise<void> {
  opened.delete(app);
  await closeApp(app);
}

/** Cria a conta na página do convite e espera o escritório abrir com ela. */
async function createAccount(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox", { name: /^Nome/ }).fill(name);
  await page.getByRole("textbox", { name: /^Senha/ }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "Repita a senha" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta e entrar" }).click();
  await expect(page.locator(".topbar .who")).toHaveText(name, { timeout: PAGE_MS });
  await page.waitForFunction(() => "__workforces" in window, undefined, { timeout: PAGE_MS });
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

test("o anfitrião cria o escritório neste computador, o convidado entra pelo pino e troca o endereço, e sair solta a porta", async () => {
  // Dois apps, um servidor que liga e reinicia e a busca UPnP: mais que o prazo padrão de um teste.
  test.setTimeout(180_000);
  const port = await freePort();

  // 1. Criar: Hospedar LAN, com o endereço sugerido, na porta sondada.
  const host = await openApp("anfitrião");
  await host.page.getByRole("button", { name: "Criar escritório" }).click();
  await expect(host.page.getByRole("heading", { name: "Escritório neste computador" })).toBeVisible();
  await expect(host.page.getByRole("radio", { name: /Hospedar LAN/ })).toBeChecked();
  const suggested = host.page.getByRole("combobox", { name: "Endereço no convite" });
  // Vazio só sem rede nenhuma; no runner, é o IPv4 dele.
  await expect(suggested).not.toHaveValue("");
  const lanAddress = await suggested.inputValue();
  await host.page.getByRole("spinbutton", { name: "Porta" }).fill(String(port));
  await host.page.getByRole("button", { name: "Criar e entrar" }).click();
  // O escritório acabou de nascer: a primeira conta vem do convite de admin dele, aberto pelo endereço deste computador.
  await expect(host.page.getByRole("heading", { name: `Criar sua conta em 127.0.0.1:${port}` })).toBeVisible({ timeout: START_MS });
  await createAccount(host.page, "ana");

  // 2. Convidar: o link do app, com o endereço escolhido e o pino do certificado.
  await host.page.getByRole("button", { name: "Gerar convite", exact: true }).click();
  const modal = host.page.getByRole("dialog", { name: "Gerar convite" });
  await modal.getByRole("button", { name: "Gerar link de convite" }).click();
  const field = modal.getByRole("textbox");
  await expect(field).toHaveValue(/^workforces:/);
  const link = await field.inputValue();
  expect(link.startsWith("workforces://invite?server=https%3A%2F%2F")).toBe(true);
  expect(link).toContain("&pin=");
  await expect(modal).toContainText('cola em "Entrar com convite"');
  const invite = new URL(link);
  const server = new URL(invite.searchParams.get("server")!);
  expect(server.hostname).toBe(lanAddress);
  expect(server.port).toBe(String(port));
  await modal.getByRole("button", { name: "Fechar" }).click();
  await expect(modal).toBeHidden();

  // 3. Entrar: o convidado abre o próprio app pelo link. Não há aviso de certificado para aceitar: o app confere o pino sozinho.
  const guest = await openApp("convidado", { link });
  await expect(guest.page.getByRole("heading", { name: `Criar sua conta em ${server.host}` })).toBeVisible({ timeout: PAGE_MS });
  await createAccount(guest.page, "bruno");
  const profile = JSON.parse(readFileSync(join(guest.dataDir, "offices.json"), "utf8")) as { offices: { pin: string | null; anchor: string | null }[] };
  expect(profile.offices).toHaveLength(1);
  const saved = profile.offices[0]!;
  expect(saved.pin).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(saved.pin).toBe(invite.searchParams.get("pin"));
  expect(saved.anchor).toContain("BEGIN CERTIFICATE");

  // 4. Trocar endereço: o mesmo escritório por outro caminho (127.0.0.1). O pino guardado vale para o endereço novo.
  await guest.page.getByRole("button", { name: "Escritórios", exact: true }).click();
  await guest.page.getByRole("button", { name: `Trocar o endereço de ${server.host}` }).click();
  await guest.page.getByRole("textbox", { name: "Novo endereço" }).fill(`https://127.0.0.1:${port}`);
  await guest.page.getByRole("button", { name: "Salvar" }).click();
  await guest.page.getByRole("button", { name: `Entrar em 127.0.0.1:${port}` }).click();
  // Direto no escritório, ainda como bruno: sem login de novo e sem convite novo.
  await expect(guest.page.locator(".topbar .who")).toHaveText("bruno", { timeout: PAGE_MS });
  // A mesma entrada, com o endereço novo e o mesmo pino.
  const moved = JSON.parse(readFileSync(join(guest.dataDir, "offices.json"), "utf8")) as { offices: { url: string; pin: string | null }[] };
  expect(moved.offices.map((office) => [office.url, office.pin])).toEqual([[`https://127.0.0.1:${port}`, saved.pin]]);

  // 5. WAN sem roteador: o runner não tem UPnP. A tela ensina a abrir a porta à mão, e o convite fica com a rede local.
  await host.page.getByRole("button", { name: "Escritórios", exact: true }).click();
  await host.page.getByRole("button", { name: "Configurar" }).click();
  // A porta salva no campo mostra que o formulário já carregou as escolhas gravadas (que senão viriam por cima da WAN).
  await expect(host.page.getByRole("spinbutton", { name: "Porta" })).toHaveValue(String(port));
  await host.page.getByRole("radio", { name: /Hospedar WAN/ }).check();
  await host.page.getByRole("button", { name: "Salvar" }).click();
  await expect(host.page.getByText("veja como abrir à mão")).toBeVisible({ timeout: WAN_MS });
  await expect(host.page.getByText("Sem o endereço da internet")).toBeVisible();

  // 6. Fechar: com o convidado ainda no escritório, sair do app do anfitrião desliga o servidor, e nenhum processo
  // dele fica segurando a porta. Antes, a porta atende: a recusa depois não é por engano da sonda.
  expect(await answers(port)).toBe(true);
  await quitApp(host.app);
  await expect.poll(() => answers(port), { timeout: PORT_FREE_MS }).toBe(false);
});
