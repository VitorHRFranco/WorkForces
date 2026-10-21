import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { BridgeSocket } from "../src/net/bridge-socket.js";
import { waitUntil } from "./helpers/wait.js";

const servers: WebSocketServer[] = [];
const sockets: BridgeSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) server.close();
});

async function startServer() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await once(wss, "listening");
  return { wss, url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/bridge` };
}

function makeSocket(url: string, livenessMs: number) {
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
    livenessMs,
  });
  sockets.push(socket);
  return socket;
}

describe("BridgeSocket: vigia de vida", () => {
  it("derruba e reconecta quando o servidor some sem fechar a conexão", async () => {
    const { wss, url } = await startServer();
    const connections: WebSocket[] = [];
    wss.on("connection", (socket) => connections.push(socket)); // aceita e nunca manda nada
    makeSocket(url, 200).start();
    await waitUntil(() => connections.length === 2, 5000, "reconexão");
  });

  it("não derruba enquanto o servidor manda ping dentro do prazo", async () => {
    const { wss, url } = await startServer();
    const connections: WebSocket[] = [];
    wss.on("connection", (socket) => connections.push(socket));
    makeSocket(url, 300).start();
    await waitUntil(() => connections.length === 1, 5000, "conexão");
    const ping = setInterval(() => connections[0]?.ping(), 80);
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(connections).toHaveLength(1);
    } finally {
      clearInterval(ping);
    }
  });
});
