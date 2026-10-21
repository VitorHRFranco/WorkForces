import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { runListener } from "../src/commands/listen.js";
import { saveConfig } from "../src/config.js";
import { waitUntil } from "./helpers/wait.js";

const dirs: string[] = [];
const servers: WebSocketServer[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

async function startServer() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await once(wss, "listening");
  return { wss, server: `http://127.0.0.1:${(wss.address() as AddressInfo).port}` };
}

function nextConnection(wss: WebSocketServer) {
  return new Promise<{ socket: WebSocket; received: unknown[] }>((resolve) => {
    wss.once("connection", (socket) => {
      const received: unknown[] = [];
      socket.on("message", (data) => received.push(JSON.parse(data.toString())));
      resolve({ socket, received });
    });
  });
}

function bufferIO() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  return { io: { stdin: new PassThrough(), stdout, stderr }, out: () => out, err: () => err };
}

/** Config com login no servidor de teste e a pasta `loja` liberada. */
function setup(server: string) {
  const home = tempDir("wf-ponte-");
  const loja = join(tempDir("wf-proj-"), "loja");
  mkdirSync(loja);
  saveConfig(home, { server, token: "wf_teste", insecure: false, folders: [{ alias: "loja", path: loja }], secretPatterns: [] });
  return { home, loja };
}

describe("workforces ponte", () => {
  it("anuncia as pastas, abre a janela quando o escritório pede e responde", async () => {
    const { wss, server } = await startServer();
    const { home, loja } = setup(server);
    const io = bufferIO();
    const opened: string[] = [];
    const clock = { now: 0 };
    const controller = new AbortController();
    const pending = nextConnection(wss);
    const run = runListener(
      { argv: ["ponte"], env: { WORKFORCES_HOME: home }, cwd: home, io: io.io, platform: "linux" },
      {
        spawner: { open: async (folder) => void opened.push(folder) },
        countOpenAgents: async () => 0,
        now: () => clock.now,
        signal: controller.signal,
        debounceMs: 20,
      },
    );
    const { socket, received } = await pending;
    await waitUntil(() => received.length === 1, 5000, "hello");
    expect(received[0]).toEqual({ type: "hello", protocol: 1, kind: "listener", aliases: ["loja"] });

    socket.send(JSON.stringify({ type: "spawn", reqId: "r1", alias: "loja" }));
    await waitUntil(() => received.length === 2, 5000, "resultado");
    expect(received[1]).toEqual({ type: "spawnResult", reqId: "r1", ok: true });
    expect(opened).toEqual([loja]);

    clock.now += 10_000;
    socket.send(JSON.stringify({ type: "spawn", reqId: "r2", alias: "site" }));
    await waitUntil(() => received.length === 3, 5000, "recusa");
    expect(received[2]).toEqual({ type: "spawnResult", reqId: "r2", ok: false, error: "unknown-alias" });
    expect(io.out()).toContain("pedido recusado (site)");

    controller.abort();
    expect(await run).toBe(0);
  });

  it("liberar uma pasta com a ponte ligada manda a lista nova ao escritório", async () => {
    const { wss, server } = await startServer();
    const { home, loja } = setup(server);
    const site = join(tempDir("wf-proj-"), "site");
    mkdirSync(site);
    const controller = new AbortController();
    const pending = nextConnection(wss);
    const run = runListener(
      { argv: ["ponte"], env: { WORKFORCES_HOME: home }, cwd: home, io: bufferIO().io, platform: "linux" },
      { spawner: { open: async () => {} }, countOpenAgents: async () => 0, signal: controller.signal, debounceMs: 20 },
    );
    const { received } = await pending;
    await waitUntil(() => received.length === 1, 5000, "hello");
    saveConfig(home, {
      server,
      token: "wf_teste",
      insecure: false,
      folders: [
        { alias: "loja", path: loja },
        { alias: "site", path: site },
      ],
      secretPatterns: [],
    });
    await waitUntil(() => received.length === 2, 5000, "pastas novas");
    expect(received[1]).toEqual({ type: "aliases", aliases: ["loja", "site"] });
    controller.abort();
    expect(await run).toBe(0);
  });

  it("sem login, ou fora do Windows sem quem abra a janela, nem liga", async () => {
    const home = tempDir("wf-ponte-");
    const io = bufferIO();
    expect(await runListener({ argv: ["ponte"], env: { WORKFORCES_HOME: home }, cwd: home, io: io.io, platform: "win32" })).toBe(2);
    expect(io.err()).toContain("sem login");
    const { server } = await startServer();
    const configured = setup(server);
    const other = bufferIO();
    expect(await runListener({ argv: ["ponte"], env: { WORKFORCES_HOME: configured.home }, cwd: configured.home, io: other.io, platform: "linux" })).toBe(2);
    expect(other.err()).toContain("só funciona no Windows");
  });

  it("com --insecure em HTTP, avisa no terminal que não há TLS", async () => {
    const { wss, server } = await startServer();
    const { home } = setup(server);
    saveConfig(home, { server, token: "wf_teste", insecure: true, folders: [], secretPatterns: [] });
    const io = bufferIO();
    const controller = new AbortController();
    const pending = nextConnection(wss);
    const run = runListener(
      { argv: ["ponte"], env: { WORKFORCES_HOME: home }, cwd: home, io: io.io, platform: "linux" },
      { spawner: { open: async () => {} }, countOpenAgents: async () => 0, signal: controller.signal, debounceMs: 20 },
    );
    await pending;
    expect(io.err()).toContain("conexão sem TLS (--insecure)");
    controller.abort();
    expect(await run).toBe(0);
  });

  it("token recusado (4001) desliga a ponte com a mensagem", async () => {
    const { wss, server } = await startServer();
    const { home } = setup(server);
    const io = bufferIO();
    const pending = nextConnection(wss);
    const run = runListener(
      { argv: ["ponte"], env: { WORKFORCES_HOME: home }, cwd: home, io: io.io, platform: "linux" },
      { spawner: { open: async () => {} }, countOpenAgents: async () => 0 },
    );
    const { socket } = await pending;
    socket.close(4001);
    expect(await run).toBe(1);
    expect(io.err()).toContain("token revogado");
  });
});
