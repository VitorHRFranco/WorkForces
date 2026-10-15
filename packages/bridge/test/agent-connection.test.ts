import { randomUUID } from "node:crypto";
import { once } from "node:events";
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

function makeConnection(url: string, extra: { random?: () => number } = {}) {
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
    expect(await first).toEqual({ type: "hello", protocol: 1, kind: "agent", agentId, label: "loja", cols: 500, rows: 40 });
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
    expect(events.fatal[0]).toContain("escritorio login");
  });
});

describe("bridgeSocketUrl", () => {
  it("converte para ws/wss e fixa o caminho", () => {
    expect(bridgeSocketUrl("https://escritorio.exemplo", false)).toBe("wss://escritorio.exemplo/ws/bridge");
    expect(bridgeSocketUrl("http://localhost:4599", false)).toBe("ws://localhost:4599/ws/bridge");
    expect(bridgeSocketUrl("http://10.0.0.5:8080", true)).toBe("ws://10.0.0.5:8080/ws/bridge");
  });

  it("recusa HTTP fora de localhost sem --insecure e esquemas estranhos", () => {
    expect(() => bridgeSocketUrl("http://10.0.0.5:8080", false)).toThrow(ServerUrlError);
    expect(() => bridgeSocketUrl("ftp://x", true)).toThrow(ServerUrlError);
  });
});
