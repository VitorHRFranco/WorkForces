import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createProbe, type AddressInfo } from "node:net";
import { EOL, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { expect, type Browser, type Page } from "@playwright/test";
import { parseOfficeMap, type OfficeMap, type Point } from "@workforces/protocol";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SERVER_CLI = join(ROOT, "packages", "server", "dist", "cli.js");
const BRIDGE_CLI = join(ROOT, "packages", "bridge", "dist", "cli.js");
const FAKE_AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
const PASSWORD = "senha-de-teste-e2e";
/** O token que o agente de brinquedo imprime (fake-agent.mjs); nunca pode chegar ao navegador. */
export const FAKE_TOKEN = "ghp_" + "E2Etokendebrinquedo".padEnd(36, "0");
/** Quanto uma caminhada pode levar até o avatar chegar (ou desistir com a posição na mensagem). */
const WALK_TIMEOUT_MS = 20_000;
const TOLERANCE = 6;

export interface Account {
  name: string;
  /** Cookie de sessão, para chamar a API como a pessoa. */
  cookie: string;
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
  private admin: Account | null = null;
  private readonly received = new Map<Page, string[]>();

  constructor(
    private readonly dir: string,
    readonly url: string,
    private readonly port: number,
    private readonly server: ChildProcess,
    private readonly adminCode: string,
    readonly map: OfficeMap,
  ) {}

  /** A primeira conta usa o convite de admin; as outras, convites gerados por ela. */
  async account(name: string): Promise<Account> {
    const code = this.admin ? await this.invite(this.admin) : this.adminCode;
    const response = await this.post(`/api/invites/${code}/accept`, { name, password: PASSWORD });
    expect(response.status).toBe(201);
    const account = { name, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
    this.admin ??= account;
    return account;
  }

  /** Entra pelo formulário, numa janela anônima própria, e espera o mapa carregar. */
  async login(browser: Browser, account: Account): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    const received: string[] = [];
    page.on("websocket", (socket) => socket.on("framereceived", (frame) => received.push(String(frame.payload))));
    this.received.set(page, received);
    await page.goto(`${this.url}/login`);
    await page.getByRole("textbox", { name: "Nome" }).fill(account.name);
    await page.getByRole("textbox", { name: "Senha" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForFunction(() => "__workforces" in window);
    return page;
  }

  /** O que o navegador recebeu pelo WebSocket (cada mensagem como texto), desde o login. */
  messagesFor(page: Page): string[] {
    return this.received.get(page) ?? [];
  }

  /** `workforces claude` de verdade, num PTY, rodando um agente de brinquedo (um .mjs) no lugar do Claude Code. */
  async startAgent(account: Account, agentScript: string = FAKE_AGENT): Promise<void> {
    const created = await this.post("/api/tokens", { name: "e2e" }, account);
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const home = join(this.dir, `ponte-${account.name}`);
    const project = join(this.dir, `projeto-${account.name}`);
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(home, "config.json"), JSON.stringify({ server: this.url, token }));
    const agent = spawnPty(process.execPath, [BRIDGE_CLI, "claude"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: project,
      env: { ...process.env, WORKFORCES_HOME: home, WORKFORCES_CLAUDE_BIN: this.launcher(account.name, agentScript) },
    });
    this.agents.push(agent);
  }

  async stop(): Promise<void> {
    // No Windows a pasta temporária só sai depois que a ponte (com o cwd lá dentro) termina.
    await Promise.all(this.agents.splice(0).map((agent) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      agent.onExit(() => {
        clearTimeout(timer);
        resolve();
      });
      agent.kill();
    })));
    if (this.server.exitCode === null && this.server.signalCode === null) {
      this.server.kill();
      await once(this.server, "exit");
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
 * cada quadro do navegador (sem GPU o jogo desenha poucos quadros por segundo, e toques curtos passariam do ponto).
 */
export async function walkTo(page: Page, target: Point, order: readonly ("x" | "y")[] = ["x", "y"]): Promise<void> {
  for (const axis of order) {
    const from = await position(page);
    const delta = target[axis] - from[axis];
    if (Math.abs(delta) <= TOLERANCE) continue;
    const forward = delta > 0;
    const key = axis === "x" ? (forward ? "ArrowRight" : "ArrowLeft") : forward ? "ArrowDown" : "ArrowUp";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ axis, goal, forward }) => {
          const at = (window as unknown as { __workforces: { position(): Point } }).__workforces.position()[axis];
          return forward ? at >= goal : at <= goal;
        },
        { axis, goal: target[axis], forward },
        { polling: "raf", timeout: WALK_TIMEOUT_MS },
      );
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
