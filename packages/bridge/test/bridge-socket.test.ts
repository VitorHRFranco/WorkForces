import { once } from "node:events";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { BridgeSocket, type BridgeSocketOptions } from "../src/net/bridge-socket.js";
import { waitUntil } from "./helpers/wait.js";

const servers: WebSocketServer[] = [];
const tcpServers: Server[] = [];
const tcpSockets: Socket[] = [];
const sockets: BridgeSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) server.close();
  for (const socket of tcpSockets.splice(0)) socket.destroy();
  await Promise.all(tcpServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await once(wss, "listening");
  return { wss, url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/bridge` };
}

function makeSocket(url: string, options: Partial<BridgeSocketOptions>) {
  const socket = new BridgeSocket({
    url,
    token: "wf_teste",
    log: () => {},
    hello: () => ({ type: "hello" }),
    onOpen: () => {},
    onMessage: () => {},
    onDrop: () => {},
    onFatal: () => {},
    random: () => 0,
    ...options,
  });
  sockets.push(socket);
  return socket;
}

describe("BridgeSocket: vigia de vida", () => {
  it("derruba e reconecta quando o servidor some sem fechar a conexão", async () => {
    const { wss, url } = await startServer();
    const connections: WebSocket[] = [];
    wss.on("connection", (socket) => connections.push(socket)); // aceita e nunca manda nada
    makeSocket(url, { livenessMs: 200 }).start();
    await waitUntil(() => connections.length === 2, 5000, "reconexão");
  });

  it("não derruba enquanto o servidor manda ping dentro do prazo", async () => {
    const { wss, url } = await startServer();
    const connections: WebSocket[] = [];
    wss.on("connection", (socket) => connections.push(socket));
    makeSocket(url, { livenessMs: 300 }).start();
    await waitUntil(() => connections.length === 1, 5000, "conexão");
    const ping = setInterval(() => connections[0]?.ping(), 80);
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(connections).toHaveLength(1);
    } finally {
      clearInterval(ping);
    }
  });

  it("handshake que não termina é abandonado e tentado de novo", async () => {
    // Aceita o TCP e nunca responde ao upgrade (como um proxy travado).
    const server = createServer((socket) => tcpSockets.push(socket));
    tcpServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/bridge`;
    let drops = 0;
    makeSocket(url, {
      handshakeTimeoutMs: 200,
      onDrop: () => {
        drops++;
      },
    }).start();
    await waitUntil(() => drops >= 1, 2000, "nova tentativa depois do prazo do handshake");
    expect(drops).toBeGreaterThanOrEqual(1);
  });
});
