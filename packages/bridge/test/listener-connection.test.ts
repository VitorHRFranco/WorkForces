import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { ListenerConnection } from "../src/net/listener-connection.js";
import { waitUntil } from "./helpers/wait.js";

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

/** Próxima conexão no servidor de teste, guardando tudo o que a ponte mandar. */
function nextConnection(wss: WebSocketServer) {
  return new Promise<{ socket: WebSocket; auth: string | undefined; received: unknown[] }>((resolve) => {
    wss.once("connection", (socket, request) => {
      const received: unknown[] = [];
      socket.on("message", (data) => received.push(JSON.parse(data.toString())));
      resolve({ socket, auth: request.headers.authorization, received });
    });
  });
}

function makeListener(url: string, aliases: string[] = ["loja"]) {
  const events = { open: 0, drops: 0, spawns: [] as { reqId: string; alias: string }[], fatal: [] as string[], logs: [] as string[] };
  const connection = new ListenerConnection({
    url,
    token: "wf_teste",
    aliases,
    log: (message) => events.logs.push(message),
    onOpen: () => events.open++,
    onDrop: () => events.drops++,
    onSpawn: (reqId, alias) => events.spawns.push({ reqId, alias }),
    onFatal: (message) => events.fatal.push(message),
    random: () => 0,
  });
  return { connection, events };
}

describe("ListenerConnection", () => {
  it("anuncia as pastas no hello, repassa o spawn e manda o resultado", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeListener(url, ["loja", "site"]);
    const pending = nextConnection(wss);
    connection.start();
    const { socket, auth, received } = await pending;
    expect(auth).toBe("Bearer wf_teste");
    await waitUntil(() => received.length === 1, 5000, "hello");
    expect(received[0]).toEqual({ type: "hello", protocol: 1, kind: "listener", aliases: ["loja", "site"] });
    socket.send(JSON.stringify({ type: "spawn", reqId: "r1", alias: "loja" }));
    await waitUntil(() => events.spawns.length === 1, 5000, "spawn");
    expect(events.spawns).toEqual([{ reqId: "r1", alias: "loja" }]);
    expect(connection.sendResult("r1", false, "folder-missing")).toBe(true);
    connection.updateAliases(["api"]);
    await waitUntil(() => received.length === 3, 5000, "resultado e pastas");
    expect(received.slice(1)).toEqual([
      { type: "spawnResult", reqId: "r1", ok: false, error: "folder-missing" },
      { type: "aliases", aliases: ["api"] },
    ]);
    connection.close();
  });

  it("ignora o que não for spawn (o servidor não manda caminho nem comando)", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeListener(url);
    const pending = nextConnection(wss);
    connection.start();
    const { socket } = await pending;
    socket.send(JSON.stringify({ type: "viewers", n: 1 }));
    socket.send(JSON.stringify({ type: "spawn", reqId: "r 1", alias: "loja" }));
    socket.send("{");
    await waitUntil(() => events.logs.filter((line) => line.includes("inválida")).length === 3, 5000, "três avisos");
    expect(events.spawns).toEqual([]);
    connection.close();
  });

  it("reconecta com a lista de pastas mais recente; token recusado (4001) é fatal", async () => {
    const { wss, url } = await startServer();
    const { connection, events } = makeListener(url, ["loja"]);
    const first = nextConnection(wss);
    connection.start();
    const one = await first;
    await waitUntil(() => one.received.length === 1, 5000, "hello");
    connection.updateAliases(["loja", "blog"]);
    const second = nextConnection(wss);
    one.socket.close(1011);
    const two = await second;
    await waitUntil(() => two.received.length === 1, 5000, "hello de novo");
    expect(two.received[0]).toEqual({ type: "hello", protocol: 1, kind: "listener", aliases: ["loja", "blog"] });
    expect(events.drops).toBe(1);
    two.socket.close(4001);
    await waitUntil(() => events.fatal.length === 1, 5000, "fatal");
    expect(events.fatal[0]).toContain("token revogado");
    connection.close();
  });
});
