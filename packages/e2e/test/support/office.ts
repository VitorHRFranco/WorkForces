import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer as createProbe, type AddressInfo } from "node:net";
import { EOL, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { _electron, errors, expect, type ElectronApplication, type Page } from "@playwright/test";
import { channelPath } from "@workforces/bridge/channel";
import {
  AgentToApp,
  LOCAL_PROTOCOL_VERSION,
  parseJson,
  parseOfficeMap,
  type AppBridge,
  type LocalStart,
  type OfficeMap,
  type Point,
} from "@workforces/protocol";
import WebSocket from "ws";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SERVER_CLI = join(ROOT, "packages", "server", "dist", "cli.js");
const BRIDGE_CLI = join(ROOT, "packages", "bridge", "dist", "cli.js");
/** O app do build: o `main` do package.json aponta para dist/main.js. */
const APP_DIR = join(ROOT, "packages", "app");
/** O executável do Electron: o pacote `electron` do app devolve o caminho dele. */
const ELECTRON = createRequire(join(APP_DIR, "package.json"))("electron") as string;
const FAKE_AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
export const PASSWORD = "senha-de-teste-e2e";
/** O token que o agente de brinquedo imprime (fake-agent.mjs); nunca pode chegar ao app. */
export const FAKE_TOKEN = "ghp_" + "E2Etokendebrinquedo".padEnd(36, "0");
/** Quanto uma caminhada pode levar até o avatar chegar (ou desistir com a posição na mensagem). */
const WALK_TIMEOUT_MS = 20_000;
/** De quanto em quanto a seta segurada se repete (mais devagar que um teclado de verdade: basta repor o aperto perdido). */
const KEY_REPEAT_MS = 250;
const TOLERANCE = 6;
/** Janela pequena: o jogo é desenhado por software sem GPU, e cada janela pesa na CPU. */
const APP_SIZE = { width: 960, height: 640 };
/** Quanto o app tem para sair sozinho antes de ser morto. */
const APP_CLOSE_MS = 10_000;
/** De quanto em quanto o harness tenta o canal local do agente, e até quando (o invólucro o abre logo depois do PTY). */
const CHANNEL_RETRY_MS = 200;
const CHANNEL_TIMEOUT_MS = 15_000;
/** Quanto do terminal do agente fica guardado para a mensagem de erro, se o canal não responder. */
const AGENT_OUTPUT_KEEP = 4_000;

export interface Account {
  name: string;
  /** Cookie de sessão, para chamar a API como a pessoa. */
  cookie: string;
}

export interface Size {
  width: number;
  height: number;
}

export interface LaunchOptions {
  /** Pasta de dados do app (padrão: uma nova dentro da pasta do teste); a mesma pasta reabre o mesmo perfil. */
  dataDir?: string;
  /** Link `workforces://` passado ao app ao abrir, como o sistema faz ao clicar num convite. */
  link?: string;
  /** Tamanho da área da página (padrão: 960 × 640). */
  size?: Size;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
}

/** O que o gravador de mensagens deixa na página. */
type RecordingWindow = { workforces: AppBridge; __e2eMessages?: string[] };

export interface AgentOptions {
  /** Nome da pasta do projeto, que vira o rótulo do robô (padrão: projeto-<nome da pessoa>). */
  project?: string;
  /** Tamanho do terminal do agente (padrão: 100 × 30). */
  cols?: number;
  rows?: number;
}

/** Uma pessoa no escritório sem o app: aparece online, anda e conversa, sem desenhar o jogo. */
export interface Presence {
  move(to: Point): void;
  chat(text: string): void;
}

/** Sobe o servidor do build numa pasta e porta temporárias; o convite de admin sai do log da primeira execução. */
export async function startOffice(): Promise<Office> {
  const dir = mkdtempSync(join(tmpdir(), "wf-e2e-"));
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, [SERVER_CLI, "start"], {
    env: { ...process.env, WF_PORT: String(port), WF_PUBLIC_URL: url, WF_DATA_DIR: join(dir, "dados") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const abort = () => {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A pasta temporária que sobrar não importa; o erro do servidor importa.
    }
  };
  const adminCode = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`o servidor não subiu:${EOL}${output}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    server.stdout!.on("data", onData);
    // WF_E2E_DEBUG=1 mostra o log do servidor junto com o do teste.
    if (process.env.WF_E2E_DEBUG) {
      server.stdout!.pipe(process.stdout);
      server.stderr!.pipe(process.stderr);
    }
    server.stderr!.on("data", onData);
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`o servidor saiu (${code}):${EOL}${output}`));
    });
  }).catch((error: unknown) => {
    abort();
    throw error;
  });
  let map: OfficeMap;
  try {
    map = parseOfficeMap(await (await fetch(`http://127.0.0.1:${port}/map/map.tmj`)).json());
  } catch (error) {
    abort();
    throw error;
  }
  return new Office(dir, url, port, server, adminCode, map);
}

export class Office {
  private readonly agents: IPty[] = [];
  /** O canal local de cada agente (fora do Windows, um socket Unix que sobra no disco se o invólucro for morto). */
  private readonly channels: string[] = [];
  private readonly apps: ElectronApplication[] = [];
  private readonly sockets: WebSocket[] = [];
  /** A pasta de dados do app aberto por `login`, por nome da conta: é onde fica o registro dos agentes dela. */
  private readonly appData = new Map<string, string>();
  private admin: Account | null = null;
  /** `localhost:<porta>`, como o app mostra o escritório. */
  readonly host: string;

  constructor(
    private readonly dir: string,
    readonly url: string,
    private readonly port: number,
    private readonly server: ChildProcess,
    private readonly adminCode: string,
    readonly map: OfficeMap,
  ) {
    this.host = new URL(url).host;
  }

  /** A primeira conta usa o convite de admin; as outras, convites gerados por ela. */
  async account(name: string): Promise<Account> {
    const code = this.admin ? await this.invite(this.admin) : this.adminCode;
    const response = await this.post(`/api/invites/${code}/accept`, { name, password: PASSWORD });
    expect(response.status).toBe(201);
    const account = { name, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
    this.admin ??= account;
    return account;
  }

  /**
   * Abre o app do build numa pasta de dados própria, sem registrar o `workforces://` no sistema. No Linux sem chaveiro,
   * `--password-store=basic` deixa o `safeStorage` no modo de texto do Chromium, e a sessão sobrevive ao reabrir.
   */
  async launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
    const dataDir = options.dataDir ?? mkdtempSync(join(this.dir, "app-"));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    const app = await _electron.launch({
      executablePath: ELECTRON,
      args: [APP_DIR, "--password-store=basic", ...(options.link ? [options.link] : [])],
      env: { ...env, WF_APP_DATA_DIR: dataDir, WF_APP_NO_PROTOCOL: "1" },
    });
    this.apps.push(app);
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height), options.size ?? APP_SIZE);
    return { app, page, dataDir };
  }

  /** Fecha o app (o Playwright pede `app.quit()` e espera o processo sair), com prazo: se vencer, mata o processo. */
  async closeApp(app: ElectronApplication): Promise<void> {
    const index = this.apps.indexOf(app);
    if (index !== -1) this.apps.splice(index, 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), APP_CLOSE_MS);
    });
    const closed = await Promise.race([app.close().then(() => true, () => false), deadline]);
    clearTimeout(timer);
    if (closed) return;
    const child = app.process();
    child.kill();
    if (!(await waitExit(child, 5_000))) {
      child.kill("SIGKILL");
      await waitExit(child, 5_000);
    }
  }

  /** Abre o app e entra por "Já tenho conta" (endereço do escritório e depois login), e espera o mapa carregar. */
  async login(account: Account, size?: Size): Promise<Page> {
    const { page, dataDir } = await this.launchApp({ size });
    const haveAccount = page.getByRole("button", { name: "Já tenho conta" });
    // A tela inicial na janela é a página do app já carregada: o gravador fica nela até o fim do teste.
    await haveAccount.waitFor();
    await page.evaluate(() => {
      const target = window as unknown as RecordingWindow;
      const messages: string[] = [];
      target.__e2eMessages = messages;
      target.workforces.socket.onEvent((_id, event) => {
        if (event.type === "message") messages.push(event.data);
      });
    });
    await haveAccount.click();
    await page.getByRole("textbox", { name: "Endereço do escritório" }).fill(this.url);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("textbox", { name: "Nome" }).fill(account.name);
    await page.getByRole("textbox", { name: "Senha" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForFunction(() => "__workforces" in window);
    this.appData.set(account.name, dataDir);
    return page;
  }

  /** O que a página recebeu do escritório pelo socket do app (cada mensagem como texto), desde o login. */
  messagesFor(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as RecordingWindow).__e2eMessages ?? []);
  }

  /** Gera um convite pela API e devolve o link do app que a página do convite (`/invite/<código>`) abre. */
  async inviteAppLink(admin: Account): Promise<string> {
    const code = await this.invite(admin);
    const response = await fetch(`http://127.0.0.1:${this.port}/invite/${code}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const match = /href="(workforces:[^"]+)"/.exec(html);
    if (!match) throw new Error(`a página do convite não tem o link do app:${EOL}${html}`);
    return match[1]!.replace(/&amp;/g, "&");
  }

  /**
   * `workforces claude` de verdade, num PTY, rodando um agente de brinquedo (um .mjs) no lugar do Claude Code. Como o
   * app faz: o endereço e o token vão pelo canal local do agente, num `start`, e nunca pela linha de comando. Com o app
   * da conta aberto, o agente entra no registro dele, como se o próprio app o tivesse aberto ("Meus agentes" só mostra esses).
   */
  async startAgent(account: Account, agentScript: string = FAKE_AGENT, options: AgentOptions = {}): Promise<void> {
    const created = await this.post("/api/tokens", { name: "e2e" }, account);
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const label = options.project ?? `projeto-${account.name}`;
    const project = join(this.dir, label);
    mkdirSync(project, { recursive: true });
    const agentId = randomUUID();
    const channelId = randomBytes(16).toString("hex");
    const channel = channelPath(channelId);
    const agent = spawnPty(process.execPath, [BRIDGE_CLI, "claude", "--agent-id", agentId, "--channel", channelId], {
      name: "xterm-256color",
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: project,
      env: { ...process.env, WORKFORCES_CLAUDE_BIN: this.launcher(account.name, agentScript) },
    });
    this.agents.push(agent);
    this.channels.push(channel);
    // O que o terminal mostrou e se o invólucro saiu: sem isso, um canal que não abre só daria "não respondeu".
    let output = "";
    let exitCode: number | null = null;
    agent.onData((data) => {
      output = (output + data).slice(-AGENT_OUTPUT_KEEP);
    });
    agent.onExit(({ exitCode: code }) => {
      exitCode = code;
    });
    try {
      await deliverStart(channel, { type: "start", server: this.url, token, label, secretPatterns: [] }, () => exitCode === null);
    } catch (error) {
      const status = exitCode === null ? "ainda rodando" : `saiu com ${exitCode}`;
      throw new Error(`o agente ${label} não recebeu o start pelo canal local (${status}):${EOL}${output}`, { cause: error });
    }
    const dataDir = this.appData.get(account.name);
    if (dataDir !== undefined) recordAgent(dataDir, { channelId, agentId, office: this.url, user: account.name, at: Date.now() });
  }

  /** Entra no escritório só com a conexão do cliente, sem abrir o app (um app a menos desenhando o jogo). */
  async connect(account: Account): Promise<Presence> {
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/ws/client`, { headers: { origin: this.url, cookie: account.cookie } });
    this.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("message", () => resolve()); // o welcome
      socket.once("error", reject);
      socket.once("close", (code) => reject(new Error(`o escritório fechou a conexão de ${account.name} (${code})`)));
    });
    const send = (message: object) => socket.send(JSON.stringify(message));
    return {
      move: (to) => send({ type: "move", x: to.x, y: to.y, dir: "up", moving: false }),
      chat: (text) => send({ type: "chat", text }),
    };
  }

  async stop(): Promise<void> {
    // Primeiro os apps e as conexões: abertos, eles ficam reconectando enquanto o servidor para.
    await Promise.all(this.apps.slice().map((app) => this.closeApp(app)));
    for (const socket of this.sockets.splice(0)) socket.terminate();
    // No Windows a pasta temporária só sai depois que a ponte (com o cwd lá dentro) termina.
    await Promise.all(this.agents.splice(0).map((agent) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      agent.onExit(() => {
        clearTimeout(timer);
        resolve();
      });
      agent.kill();
    })));
    // Os sockets que os invólucros mortos deixaram: o app dos próximos testes nem tenta conectar neles.
    if (process.platform !== "win32") for (const channel of this.channels.splice(0)) rmSync(channel, { force: true });
    // Com prazo: esperar a saída sem limite já travou o afterAll por 90 s.
    this.server.kill();
    if (!(await waitExit(this.server, 10_000))) {
      this.server.kill("SIGKILL");
      await waitExit(this.server, 5_000);
    }
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  private async invite(account: Account): Promise<string> {
    const response = await this.post("/api/invites", {}, account);
    expect(response.status).toBe(201);
    const { url } = (await response.json()) as { url: string };
    return url.slice(url.lastIndexOf("/") + 1);
  }

  private post(path: string, body: unknown, account?: Account): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.url, ...(account ? { cookie: account.cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  /** WORKFORCES_CLAUDE_BIN precisa ser um executável: um .cmd no Windows, um script de shell nos outros. */
  private launcher(name: string, script: string): string {
    if (process.platform === "win32") {
      const file = join(this.dir, `agente-${name}.cmd`);
      writeFileSync(file, `@"${process.execPath}" "${script}" %*${EOL}`);
      return file;
    }
    const file = join(this.dir, `agente-${name}.sh`);
    writeFileSync(file, `#!/bin/sh${EOL}exec "${process.execPath}" "${script}" "$@"${EOL}`);
    chmodSync(file, 0o755);
    return file;
  }
}

/** O assento da mesa (o primeiro dentro da zona dela): quem para ali aparece sentado para os outros. */
export function deskSeat(map: OfficeMap, deskId: string): Point {
  const zone = map.desks.find((candidate) => candidate.id === deskId)?.zone;
  const seat = zone && map.seats.find((s) => s.x >= zone.x && s.x <= zone.x + zone.width && s.y >= zone.y && s.y <= zone.y + zone.height);
  if (!seat) throw new Error(`a mesa ${deskId} não tem assento no mapa`);
  return { x: seat.x, y: seat.y };
}

/**
 * Um ponto dentro da zona da mesa, no centro da largura e perto do fundo (onde fica a cadeira, fora do móvel). O centro
 * dá folga dos dois lados: no runner lento o avatar passa do alvo e ainda não sai da zona.
 */
export function deskSpot(map: OfficeMap, deskId: string): Point {
  const desk = map.desks.find((candidate) => candidate.id === deskId);
  if (!desk) throw new Error(`mesa ${deskId} não está no mapa`);
  return { x: desk.zone.x + desk.zone.width / 2, y: desk.zone.y + desk.zone.height - 8 };
}

/**
 * Anda com as setas até o alvo, um eixo de cada vez: segura a seta e solta quando o avatar passa do alvo, conferindo a
 * cada quadro da página (sem GPU o jogo desenha poucos quadros por segundo, e toques curtos passariam do ponto).
 *
 * A seta segurada se repete, como num teclado de verdade: o jogo descarta a tecla que chega antes de ele ter as setas de
 * volta (o Esc do chat só as devolve depois do quadro seguinte), e o primeiro aperto sozinho se perderia.
 */
export async function walkTo(page: Page, target: Point, order: readonly ("x" | "y")[] = ["x", "y"]): Promise<void> {
  for (const axis of order) {
    const from = await position(page);
    const delta = target[axis] - from[axis];
    if (Math.abs(delta) <= TOLERANCE) continue;
    const forward = delta > 0;
    const key = axis === "x" ? (forward ? "ArrowRight" : "ArrowLeft") : forward ? "ArrowDown" : "ArrowUp";
    const deadline = Date.now() + WALK_TIMEOUT_MS;
    await page.keyboard.down(key);
    try {
      for (;;) {
        try {
          await page.waitForFunction(
            ({ axis, goal, forward }) => {
              const at = (window as unknown as { __workforces: { position(): Point } }).__workforces.position()[axis];
              return forward ? at >= goal : at <= goal;
            },
            { axis, goal: target[axis], forward },
            { polling: "raf", timeout: Math.max(1, Math.min(KEY_REPEAT_MS, deadline - Date.now())) },
          );
          break;
        } catch (error) {
          if (!(error instanceof errors.TimeoutError) || Date.now() >= deadline) throw error;
          await page.keyboard.down(key); // a repetição (KeyboardEvent.repeat)
        }
      }
    } catch (error) {
      throw new Error(`o avatar não chegou a ${axis}=${target[axis]}: parou em ${JSON.stringify(await position(page))}`, {
        cause: error,
      });
    } finally {
      await page.keyboard.up(key);
    }
  }
}

function position(page: Page): Promise<Point> {
  return page.evaluate(() => (window as unknown as { __workforces: { position(): Point } }).__workforces.position());
}

/**
 * Faz o papel do app no canal local do agente: tenta conectar a cada 200 ms (o invólucro abre o canal logo depois de
 * subir) e, conectado, manda `hello` e `start` e espera o `info` com o escritório. Desiste se o agente sair.
 */
async function deliverStart(path: string, start: LocalStart, alive: () => boolean): Promise<void> {
  const deadline = Date.now() + CHANNEL_TIMEOUT_MS;
  let reason = "o canal não abriu";
  while (Date.now() < deadline && alive()) {
    try {
      await sendStart(path, start, deadline - Date.now());
      return;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, CHANNEL_RETRY_MS));
  }
  throw new Error(alive() ? `sem confirmação em ${CHANNEL_TIMEOUT_MS / 1000} s: ${reason}` : `o agente saiu: ${reason}`);
}

/**
 * Uma conexão com o canal: uma mensagem JSON por linha. Fecha logo depois do `info` com o escritório, porque o canal
 * atende um cliente por vez e o app do teste conecta nele depois. Se outro cliente derrubar esta conexão depois do
 * `start`, a próxima tentativa recebe no primeiro `info` o escritório que já ficou valendo.
 */
function sendStart(path: string, start: LocalStart, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let pending = "";
    let sent = false;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        socket.end();
        resolve();
      }
    };
    const timer = setTimeout(() => finish(new Error("o agente não respondeu no prazo")), timeoutMs);
    const send = (message: object) => socket.write(`${JSON.stringify(message)}\n`);
    socket.setEncoding("utf8");
    socket.on("connect", () => send({ type: "hello", protocol: LOCAL_PROTOCOL_VERSION }));
    socket.on("data", (chunk: string | Buffer) => {
      pending += String(chunk);
      for (let end = pending.indexOf("\n"); end !== -1 && !done; end = pending.indexOf("\n")) {
        const message = parseJson(AgentToApp, pending.slice(0, end));
        pending = pending.slice(end + 1);
        // Até o `info` com o escritório, o resto (quadros, status) não interessa.
        if (message?.type !== "info") continue;
        if (message.office === start.server) finish();
        else if (message.office !== null) finish(new Error(`o agente já está noutro escritório (${message.office})`));
        else if (!sent) {
          sent = true;
          send(start);
        }
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("o canal fechou antes de confirmar o escritório")));
  });
}

/**
 * Acrescenta o agente ao `local-agents.json` do app, como o app faz ao entregar o `start`. O app relê o arquivo a cada
 * `scan`: a gravação passa por um temporário e um `rename`, e ele nunca lê um arquivo pela metade.
 */
function recordAgent(dataDir: string, record: { channelId: string; agentId: string; office: string; user: string; at: number }): void {
  const file = join(dataDir, "local-agents.json");
  let agents: unknown[] = [];
  try {
    agents = (JSON.parse(readFileSync(file, "utf8")) as { agents: unknown[] }).agents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tmp = `${file}.e2e.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, agents: [...agents, record] }, null, 2));
  renameSync(tmp, file);
}

/** Resolve `true` quando o processo sai e `false` se o prazo acabar antes. */
function waitExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
