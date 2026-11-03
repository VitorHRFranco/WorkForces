import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { LOCAL_PROTOCOL_VERSION } from "@workforces/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { channelPath } from "../src/channel/index.js";
import { main } from "../src/main.js";
import { stripAnsi } from "./helpers/ansi.js";
import { sleep, waitUntil } from "./helpers/wait.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const cleanTempDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
};

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const APP_MESSAGE = 'abra o agente pelo app do WorkForces ("Chamar agente")';

function bufferIO() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  return { io: { stdin: new PassThrough(), stdout, stderr }, out: () => out, err: () => err };
}

const home = () => tempDir("wf-main-");
const channelId = () => randomBytes(16).toString("hex");
const agentArgs = (agentId = randomUUID(), channel = channelId()) => ["--agent-id", agentId, "--channel", channel];

const sockets: Socket[] = [];
const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  cleanTempDirs();
});

const context = (argv: string[], env: NodeJS.ProcessEnv, io = bufferIO()) => ({
  ctx: { argv, env, cwd: process.cwd(), io: io.io, platform: process.platform },
  io,
});

/** Conecta ao canal assim que o invólucro abrir; junta as linhas recebidas. */
async function channelClient(path: string) {
  for (let attempt = 0; ; attempt++) {
    const socket = connect(path);
    sockets.push(socket);
    const opened = await Promise.race([once(socket, "connect").then(() => true), once(socket, "error").then(() => false)]);
    if (opened) {
      let raw = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        raw += chunk;
      });
      socket.on("error", () => {});
      return {
        send: (message: unknown) => socket.write(`${JSON.stringify(message)}\n`),
        messages: () =>
          raw
            .split("\n")
            .filter(Boolean)
            .map((text) => JSON.parse(text) as Record<string, unknown>),
      };
    }
    if (attempt > 100) throw new Error(`o canal ${path} não abriu`);
    await sleep(50);
  }
}

describe("main", () => {
  it("sem argumentos mostra o uso", async () => {
    const { ctx, io } = context([], { WORKFORCES_HOME: home() });
    expect(await main(ctx)).toBe(0);
    expect(io.out()).toContain("workforces claude --agent-id <uuid> --channel <id>");
    expect(io.out()).not.toContain("login");
  });

  it("comando desconhecido devolve 2", async () => {
    const { ctx, io } = context(["login"], { WORKFORCES_HOME: home() });
    expect(await main(ctx)).toBe(2);
    expect(io.err()).toContain("comando desconhecido: login");
  });

  it("claude sem --channel, ou com --agent-id inválido, sai com 2 e pede o app", async () => {
    const env = { ...process.env, WORKFORCES_HOME: home(), WORKFORCES_CLAUDE_BIN: process.execPath };
    for (const argv of [
      ["claude", FAKE, "--once"],
      ["claude", "--agent-id", randomUUID(), FAKE, "--once"],
      ["claude", "--agent-id", "nao-e-uuid", "--channel", channelId(), FAKE, "--once"],
      ["claude", "--agent-id", randomUUID(), "--channel", "../x", FAKE, "--once"],
      ["claude", "--agent-id", randomUUID(), "--channel"],
    ]) {
      const { ctx, io } = context(argv, env);
      expect(await main(ctx)).toBe(2);
      expect(io.err()).toContain(APP_MESSAGE);
    }
  });

  it("claude fora do PATH devolve 127", async () => {
    const { ctx, io } = context(["claude", ...agentArgs()], { WORKFORCES_HOME: home(), PATH: home() });
    expect(await main(ctx)).toBe(127);
    expect(io.err()).toContain("não encontrei o `claude`");
  });

  it("sem terminal roda o claude direto e repassa o código", async () => {
    const env = { ...process.env, WORKFORCES_HOME: home(), WORKFORCES_CLAUDE_BIN: process.execPath };
    const { ctx } = context(["claude", ...agentArgs(), FAKE, "--once"], env);
    expect(await main(ctx)).toBe(5);
  });

  it("o start pelo canal liga o espelho ao escritório, e os avisos aparecem ao sair", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(wss);
    await once(wss, "listening");
    const seen: { authorization?: string; hello?: Record<string, unknown> } = {};
    wss.on("connection", (socket, request) => {
      seen.authorization = request.headers.authorization;
      socket.once("message", (data) => {
        seen.hello = JSON.parse(data.toString()) as Record<string, unknown>;
      });
    });

    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
    const stderr = new PassThrough();
    let out = "";
    let err = "";
    stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    const agentId = randomUUID();
    const channel = channelId();
    const env = { ...process.env, WORKFORCES_HOME: home(), WORKFORCES_CLAUDE_BIN: process.execPath };
    const done = main({
      argv: ["claude", ...agentArgs(agentId, channel), FAKE],
      env,
      cwd: process.cwd(),
      io: { stdin, stdout, stderr },
      platform: process.platform,
    });
    await waitUntil(() => stripAnsi(out).includes("OLÁ_DO_FALSO"), 15_000, "saída do falso");

    const app = await channelClient(channelPath(channel));
    app.send({ type: "hello", protocol: LOCAL_PROTOCOL_VERSION });
    await waitUntil(() => app.messages().length >= 1, 5000, "info");
    expect(app.messages()[0]).toMatchObject({ type: "info", agentId, label: null, office: null, cols: 100, rows: 30 });

    const server = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const token = "wf_" + "t".repeat(43);
    app.send({ type: "start", server, token, label: "loja", secretPatterns: ["("] });
    // O espelho também manda `status` pelo canal quando o Claude muda de estado, a qualquer momento: só os `info` contam.
    const infos = () => app.messages().filter((message) => message.type === "info");
    await waitUntil(() => infos().length >= 2, 5000, "info depois do start");
    expect(infos()[1]).toMatchObject({ type: "info", label: "loja", office: server });
    await waitUntil(() => seen.hello !== undefined, 10_000, "hello no escritório");
    expect(seen.authorization).toBe(`Bearer ${token}`);
    expect(seen.hello).toMatchObject({ type: "hello", kind: "agent", agentId, label: "loja" });
    expect(stripAnsi(out)).not.toContain(token);

    stdin.write("sair\r");
    expect(await done).toBe(7);
    // Durante a sessão a ponte não escreve no terminal: o aviso só aparece ao sair, uma vez.
    expect(err.split("padrão de segredo inválido").length - 1).toBe(1);
  });
});
