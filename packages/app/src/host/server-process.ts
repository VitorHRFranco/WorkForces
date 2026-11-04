import { fork as nodeFork, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { EmbeddedToHost, HostToEmbedded } from "@workforces/protocol";

export interface ServerLaunch {
  /** O Node do sistema (o `better-sqlite3` é construído para ele, não para o Electron). */
  node: string;
  entry: string;
  host: string;
  port: number;
  publicUrl: string;
  dataDir: string;
}

export type ServerStart =
  | { ok: true; pin: string; anchor: string; adminInvite: string | null }
  | { ok: false; error: "port-in-use" | "failed" | "timeout" };

const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;

/** O servidor do escritório num processo filho, controlado pelo canal IPC do `fork`. */
export class EmbeddedServer {
  private child: ChildProcess | null = null;
  private exitListeners: Array<() => void> = [];
  private readonly fork: typeof nodeFork;
  private readonly log: (message: string) => void;
  private readonly readyTimeoutMs: number;

  constructor(deps: { fork?: typeof nodeFork; log(message: string): void; readyTimeoutMs?: number }) {
    this.fork = deps.fork ?? nodeFork;
    this.log = deps.log;
    this.readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  }

  running(): boolean {
    return this.child !== null;
  }

  /** Avisa quando o filho sai sem que ninguém tenha pedido (o `stop` e o prazo de `start` não contam). */
  onExit(listener: () => void): void {
    this.exitListeners.push(listener);
  }

  start(launch: ServerLaunch): Promise<ServerStart> {
    if (this.child) return Promise.resolve({ ok: false, error: "failed" });
    // O filho não herda nenhuma WF_* do app: a configuração dele é só a que o app monta aqui.
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("WF_")) env[key] = value;
    Object.assign(env, {
      WF_PORT: String(launch.port),
      WF_HOST: launch.host,
      WF_PUBLIC_URL: launch.publicUrl,
      WF_DATA_DIR: launch.dataDir,
      WF_TLS: "self-signed",
    });
    const child = this.fork(launch.entry, [], { execPath: launch.node, execArgv: [], env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    this.child = child;
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) createInterface({ input: stream }).on("line", (line) => this.log(`[escritório] ${line}`));
    }
    return new Promise<ServerStart>((resolve) => {
      let settled = false;
      let expected = false;
      let ready = false;
      const settle = (result: ServerStart) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        expected = true;
        settle({ ok: false, error: "timeout" });
        child.kill();
      }, this.readyTimeoutMs);
      child.on("message", (message: EmbeddedToHost) => {
        if (settled) return;
        if (message?.type === "ready") {
          ready = true;
          settle({ ok: true, pin: message.pin, anchor: message.anchor, adminInvite: message.adminInvite });
        } else if (message?.type === "failed") settle({ ok: false, error: message.reason === "port-in-use" ? "port-in-use" : "failed" });
      });
      child.on("error", (error) => {
        this.log(`[escritório] erro no processo: ${error.message}`);
        // Sem processo (ex.: o Node não existe) não vem "exit": solta o filho aqui, ou o app nunca mais tenta.
        if (child.pid === undefined && this.child === child) this.child = null;
        settle({ ok: false, error: "failed" });
      });
      child.on("exit", (code) => {
        if (this.child === child) this.child = null;
        if (!settled) this.log(`[escritório] o servidor saiu antes de responder (código ${code})`);
        settle({ ok: false, error: "failed" });
        if (ready && !expected && !this.stopping.has(child)) for (const listener of this.exitListeners) listener();
      });
    });
  }

  /** Os filhos que o app mandou parar (a saída deles é esperada). */
  private readonly stopping = new WeakSet<ChildProcess>();

  /** Pede o fim ao filho e, passado o prazo, mata. */
  async stop(timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping.add(child);
    // Nunca subiu ou já saiu: não há "exit" a esperar.
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
      if (this.child === child) this.child = null;
      return;
    }
    await new Promise<void>((resolve) => {
      // SIGKILL: um filho preso no fechamento ignoraria o SIGTERM; e o prazo vale mesmo que nenhum "exit" chegue.
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (this.child === child) this.child = null;
        resolve();
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.send({ type: "stop" } satisfies HostToEmbedded);
      } catch {
        child.kill("SIGKILL");
      }
    });
  }
}
