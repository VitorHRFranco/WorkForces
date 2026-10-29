import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentConnection, ServerUrlError, bridgeSocketUrl } from "../src/net/agent-connection.js";
import { sleep, waitUntil } from "./helpers/wait.js";

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function startServer() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await once(wss, "listening");
  return { wss, url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/bridge` };
}

function nextConnection(wss: WebSocketServer) {
  return new Promise<{ socket: WebSocket; auth: string | undefined; first: Promise<unknown> }>((resolve) => {
    wss.once("connection", (socket, request) => {
      const first = new Promise((done) => socket.once("message", (data) => done(JSON.parse(data.toString()))));
      resolve({ socket, auth: request.headers.authorization, first });
    });
  });
}

function makeConnection(url: string, extra: { random?: () => number; stableMs?: number } = {}) {
  const events = { open: 0, viewers: [] as number[], fatal: [] as string[], logs: [] as string[] };
  const agentId = randomUUID();
  const connection = new AgentConnection({
    url,
    token: "wf_teste",
    hello: { agentId, label: "loja", cols: 600, rows: 40 },
    log: (message) => events.logs.push(message),
    handlers: {
      onOpen: () => events.open++,
      onViewers: (n) => events.viewers.push(n),
      onFatal: (message) => events.fatal.push(message),
    },
    ...extra,
  });
  return { connection, events, agentId };
}

describe("AgentConnection", () => {
  it("autentica com Bearer, manda hello com tamanho limitado e repassa viewers", async () => {
    const { wss, url } = await startServer();
    const { connection, events, agentId } = makeConnection(url);
    const pending = nextConnection(wss);
    connection.start();
    const { socket, auth, first } = await pending;
    expect(auth).toBe("Bearer wf_teste");
    expect(await first).toEqual({ type: "hello", protocol: 2, kind: "agent", agentId, label: "loja", cols: 500, rows: 40 });
    await waitUntil(() => events.open === 1, 5000, "onOpen");
    socket.send(JSON.stringify({ type: "viewers", n: 2 }));
    await waitUntil(() => events.viewers.includes(2), 5000, "viewers");
    expect(connection.send({ type: "status", state: "working" })).toBe(true);
    connection.close();
  });

  it("não envia antes de conectar", () => {
    const { connection } = makeConnection("ws://127.0.0.1:1/ws/bridge");
    expect(connection.send({ type: "status", state: "idle" })).toBe(false);
  });

  it("ignora mensagem inválida do servidor", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeConnection(url);
    const pending = nextConnection(wss);
    connection.start();
    const { socket } = await pending;
    socket.send(JSON.stringify({ type: "input", data: "sair\r" }));
    await waitUntil(() => events.logs.some((l) => l.includes("inválida")), 5000, "log");
    expect(events.viewers).toEqual([]);
    connection.close();
  });

  it("reconecta quando o servidor fecha a conexão", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeConnection(url, { random: () => 0 });
    const first = nextConnection(wss);
    connection.start();
    (await first).socket.close(1011);
    const second = nextConnection(wss);
    expect(await (await second).first).toMatchObject({ type: "hello" });
    expect(events.viewers).toContain(0);
    connection.close();
  });

  it("para de tentar quando o token é recusado (4001)", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeConnection(url, { random: () => 0 });
    const first = nextConnection(wss);
    connection.start();
    (await first).socket.close(4001);
    await waitUntil(() => events.fatal.length === 1, 5000, "onFatal");
    let reconnected = false;
    wss.once("connection", () => {
      reconnected = true;
    });
    await sleep(1200);
    expect(reconnected).toBe(false);
    expect(events.fatal[0]).toContain("chame o agente de novo pelo app do WorkForces");
  });

  const delays = (logs: string[]) =>
    logs.map((line) => /nova tentativa em (\d+) ms/.exec(line)?.[1]).filter((value): value is string => value !== undefined).map(Number);

  it("não volta ao início da espera se a conexão cai logo depois de abrir", async () => {
    const { wss, url } = await startServer();
    wss.on("connection", (socket) => socket.once("message", () => socket.close(1011)));
    const { connection, events } = makeConnection(url, { random: () => 0 });
    connection.start();
    await waitUntil(() => delays(events.logs).length >= 2, 8000, "duas reconexões");
    expect(delays(events.logs).slice(0, 2)).toEqual([800, 1600]);
    connection.close();
  });

  it("volta ao início da espera depois de uma conexão estável", async () => {
    const { wss, url } = await startServer();
    wss.on("connection", (socket) => socket.once("message", () => setTimeout(() => socket.close(1011), 150)));
    const { connection, events } = makeConnection(url, { random: () => 0, stableMs: 50 });
    connection.start();
    await waitUntil(() => delays(events.logs).length >= 2, 8000, "duas reconexões");
    expect(delays(events.logs).slice(0, 2)).toEqual([800, 800]);
    connection.close();
  });

  it("HTTP 401 no upgrade também é fatal", async () => {
    const http = createHttpServer();
    http.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const port = (http.address() as AddressInfo).port;
    const { connection, events } = makeConnection(`ws://127.0.0.1:${port}/ws/bridge`, { random: () => 0 });
    connection.start();
    await waitUntil(() => events.fatal.length === 1, 5000, "onFatal");
    expect(events.fatal[0]).toContain("chame o agente de novo pelo app do WorkForces");
    await sleep(1200);
    expect(delays(events.logs)).toEqual([]);
    http.close();
  });

  it("HTTP 403 no upgrade não para a ponte", async () => {
    const http = createHttpServer();
    http.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const port = (http.address() as AddressInfo).port;
    const { connection, events } = makeConnection(`ws://127.0.0.1:${port}/ws/bridge`, { random: () => 0 });
    connection.start();
    await waitUntil(() => delays(events.logs).length >= 1, 5000, "nova tentativa");
    expect(events.fatal).toEqual([]);
    connection.close();
    http.close();
  });
});

describe("bridgeSocketUrl", () => {
  it("converte para ws/wss e fixa o caminho", () => {
    expect(bridgeSocketUrl("https://workforces.exemplo", false)).toBe("wss://workforces.exemplo/ws/bridge");
    expect(bridgeSocketUrl("http://localhost:4599", false)).toBe("ws://localhost:4599/ws/bridge");
    expect(bridgeSocketUrl("http://10.0.0.5:8080", true)).toBe("ws://10.0.0.5:8080/ws/bridge");
  });

  it("recusa HTTP fora de localhost sem --insecure e esquemas estranhos", () => {
    expect(() => bridgeSocketUrl("http://10.0.0.5:8080", false)).toThrow(ServerUrlError);
    expect(() => bridgeSocketUrl("ftp://x", true)).toThrow(ServerUrlError);
  });
});
