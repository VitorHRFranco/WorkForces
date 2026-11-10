import { fork as nodeFork, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as netServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { officeFetch } from "../src/net/pinned.js";
import { EmbeddedServer, type ServerLaunch } from "../src/host/server-process.js";

const fakeEntry = fileURLToPath(new URL("./fixtures/fake-embedded.mjs", import.meta.url));
const realEntry = fileURLToPath(new URL("../../server/dist/embedded.js", import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = netServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** true quando algo aceita conexão na porta. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

let dir: string;
let servers: EmbeddedServer[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-proc-"));
  servers = [];
});
afterEach(async () => {
  for (const server of servers) await server.stop(300);
  rmSync(dir, { recursive: true, force: true });
});

const launchFor = (entry: string, port: number): ServerLaunch => ({
  node: process.execPath,
  entry,
  host: "127.0.0.1",
  port,
  publicUrl: `https://127.0.0.1:${port}`,
  dataDir: dir,
});

/** `mode` em lista: um modo por filho, na ordem dos `start`. */
function fakeServer(mode: string | string[], extra: { readyTimeoutMs?: number; envSeen?: NodeJS.ProcessEnv[]; children?: ChildProcess[] } = {}) {
  const logs: string[] = [];
  const modes = typeof mode === "string" ? [] : [...mode];
  const next = (): string => (typeof mode === "string" ? mode : (modes.shift() ?? "ready"));
  const server = new EmbeddedServer({
    log: (message) => logs.push(message),
    readyTimeoutMs: extra.readyTimeoutMs,
    fork: ((entry, args, options) => {
      extra.envSeen?.push(options?.env ?? {});
      const child = nodeFork(entry, args, { ...options, env: { ...options?.env, FAKE_MODE: next() } });
      extra.children?.push(child);
      return child;
    }) as typeof nodeFork,
  });
  servers.push(server);
  return { server, logs };
}

describe("EmbeddedServer com o dublê", () => {
  it("ready dá ok e running()", async () => {
    const { server } = fakeServer("ready");
    const result = await server.start(launchFor(fakeEntry, 4700));
    expect(result).toMatchObject({ ok: true, anchor: "ANCHOR", adminInvite: null });
    expect(server.running()).toBe(true);
    expect(await server.start(launchFor(fakeEntry, 4700))).toEqual({ ok: false, error: "failed" });
    await server.stop();
    expect(server.running()).toBe(false);
  });

  it("porta ocupada dá port-in-use", async () => {
    const { server } = fakeServer("port");
    expect(await server.start(launchFor(fakeEntry, 4700))).toEqual({ ok: false, error: "port-in-use" });
  });

  it("sem resposta dá timeout e mata o filho", async () => {
    const { server } = fakeServer("silent", { readyTimeoutMs: 500 });
    expect(await server.start(launchFor(fakeEntry, 4700))).toEqual({ ok: false, error: "timeout" });
    await expect.poll(() => server.running(), { timeout: 3000 }).toBe(false);
  });

  it("filho preso na subida (ignora o SIGTERM e o stop) some no prazo, e o start seguinte funciona", async () => {
    const children: ChildProcess[] = [];
    const { server } = fakeServer(["hung", "ready"], { readyTimeoutMs: 500, children });
    expect(await server.start(launchFor(fakeEntry, 4700))).toEqual({ ok: false, error: "timeout" });
    // Logo depois do prazo, sem esperar: o filho preso não pode travar a próxima tentativa.
    expect((await server.start(launchFor(fakeEntry, 4700))).ok).toBe(true);
    const hung = children[0]!;
    await expect.poll(() => hung.exitCode !== null || hung.signalCode !== null, { timeout: 3000 }).toBe(true);
  });

  it("saída que ninguém pediu chama onExit", async () => {
    const { server } = fakeServer("crash");
    let exited = 0;
    server.onExit(() => exited++);
    expect((await server.start(launchFor(fakeEntry, 4700))).ok).toBe(true);
    await expect.poll(() => exited, { timeout: 3000 }).toBe(1);
    expect(server.running()).toBe(false);
  });

  it("stop não chama onExit", async () => {
    const { server } = fakeServer("ready");
    let exited = 0;
    server.onExit(() => exited++);
    await server.start(launchFor(fakeEntry, 4700));
    await server.stop();
    expect(exited).toBe(0);
  });

  it("filho que ignora o stop é morto no prazo", async () => {
    const { server } = fakeServer("stubborn");
    await server.start(launchFor(fakeEntry, 4700));
    await server.stop(300);
    expect(server.running()).toBe(false);
  });

  it("o env do filho não herda WF_* e leva a configuração do app", async () => {
    process.env.WF_TLS_PIN_FILE = "/herdado";
    const envSeen: NodeJS.ProcessEnv[] = [];
    try {
      const { server } = fakeServer("ready", { envSeen });
      await server.start(launchFor(fakeEntry, 4701));
    } finally {
      delete process.env.WF_TLS_PIN_FILE;
    }
    const env = envSeen[0]!;
    expect(env.WF_TLS_PIN_FILE).toBeUndefined();
    expect(env).toMatchObject({ WF_PORT: "4701", WF_HOST: "127.0.0.1", WF_PUBLIC_URL: "https://127.0.0.1:4701", WF_DATA_DIR: dir, WF_TLS: "self-signed" });
  });

  it("as linhas do filho (stdout e stderr) vão para o log com o prefixo", async () => {
    const { server, logs } = fakeServer("output");
    await server.start(launchFor(fakeEntry, 4700));
    await expect.poll(() => logs).toEqual(expect.arrayContaining(["[escritório] linha-stdout", "[escritório] linha-stderr"]));
  });

  it("Node inexistente: failed, não trava e uma nova tentativa funciona", async () => {
    const { server } = fakeServer("ready");
    const result = await server.start({ ...launchFor(fakeEntry, 4700), node: join(dir, "nao-existe-node") });
    expect(result).toEqual({ ok: false, error: "failed" });
    expect(server.running()).toBe(false);
    await server.stop(300);
    expect((await server.start(launchFor(fakeEntry, 4700))).ok).toBe(true);
  });
});

describe.skipIf(!existsSync(realEntry))("EmbeddedServer com o servidor de verdade", () => {
  it("liga, responde com a âncora e desliga", async () => {
    const port = await freePort();
    const server = new EmbeddedServer({ log: () => {} });
    servers.push(server);
    const result = await server.start(launchFor(realEntry, port));
    if (!result.ok) throw new Error(`não subiu: ${result.error}`);
    const response = await officeFetch(result.anchor)(`https://127.0.0.1:${port}/api/health`);
    expect(response.status).toBe(200);
    await server.stop();
    expect(await accepts(port)).toBe(false);
  }, 30_000);

  it("o app cair (disconnect) faz o filho sair sozinho e liberar a porta", async () => {
    const port = await freePort();
    const child = nodeFork(realEntry, [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...process.env, WF_HOST: "127.0.0.1", WF_PORT: String(port), WF_PUBLIC_URL: `https://127.0.0.1:${port}`, WF_DATA_DIR: dir, WF_TLS: "self-signed" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve());
        child.once("exit", () => reject(new Error("o filho saiu antes do ready")));
      });
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.disconnect();
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("o filho não saiu em 5 s")), 5000))]);
      expect(await accepts(port)).toBe(false);
    } finally {
      child.kill();
    }
  }, 30_000);
});
