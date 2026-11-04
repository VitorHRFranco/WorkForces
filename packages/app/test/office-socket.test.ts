import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { SocketEvent } from "@workforces/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { SocketRelay } from "../src/net/office-socket.js";

interface Conn {
  socket: WebSocket;
  req: IncomingMessage;
  received: string[];
  closeCode: Promise<number>;
}

const servers: WebSocketServer[] = [];
const relays: SocketRelay[] = [];

async function fakeServer(): Promise<{ url: string; conns: Conn[]; next(): Promise<Conn> }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const conns: Conn[] = [];
  const waiting: Array<(c: Conn) => void> = [];
  wss.on("connection", (socket, req) => {
    const conn: Conn = {
      socket,
      req,
      received: [],
      closeCode: new Promise((resolve) => socket.on("close", (code) => resolve(code))),
    };
    socket.on("message", (data) => conn.received.push(data.toString()));
    conns.push(conn);
    waiting.shift()?.(conn);
  });
  let taken = 0;
  const next = () => (conns.length > taken ? Promise.resolve(conns[taken++]) : new Promise<Conn>((resolve) => waiting.push((c) => { taken++; resolve(c); })));
  return { url: `http://127.0.0.1:${(wss.address() as AddressInfo).port}`, conns, next };
}

function makeRelay() {
  const events: Array<[number, SocketEvent]> = [];
  const onUnauthorized = vi.fn();
  const relay = new SocketRelay((id, event) => events.push([id, event]), onUnauthorized);
  relays.push(relay);
  return { relay, events, onUnauthorized };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};
const opened = (events: Array<[number, SocketEvent]>, id: number) => events.some(([i, e]) => i === id && e.type === "open");

afterEach(async () => {
  for (const r of relays.splice(0)) r.closeAll();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          for (const c of s.clients) c.terminate();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("SocketRelay", () => {
  it("abre com Bearer no escritório e repassa nos dois sentidos", async () => {
    const server = await fakeServer();
    const { relay, events } = makeRelay();
    relay.open(1, { url: server.url, session: "s1", anchor: null });
    const conn = await server.next();
    expect(conn.req.headers.authorization).toBe("Bearer s1");
    expect(conn.req.headers.origin).toBeUndefined();
    expect(conn.req.url).toBe("/ws/client");
    await until(() => opened(events, 1));
    conn.socket.send("oi");
    await until(() => events.some(([, e]) => e.type === "message"));
    expect(events).toContainEqual([1, { type: "message", data: "oi" }]);
    relay.send(1, "olá");
    await until(() => conn.received.length === 1);
    expect(conn.received).toEqual(["olá"]);
  });

  it("4001 do servidor avisa que a sessão acabou", async () => {
    const server = await fakeServer();
    const { relay, events, onUnauthorized } = makeRelay();
    relay.open(1, { url: server.url, session: "s1", anchor: null });
    const conn = await server.next();
    conn.socket.close(4001);
    await until(() => events.some(([, e]) => e.type === "close"));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual([1, { type: "close", code: 4001 }]);
  });

  it("abrir outra conexão fecha a anterior; o id antigo não manda mais", async () => {
    const server = await fakeServer();
    const { relay, events } = makeRelay();
    relay.open(1, { url: server.url, session: "s1", anchor: null });
    const first = await server.next();
    await until(() => opened(events, 1));
    relay.open(2, { url: server.url, session: "s1", anchor: null });
    expect(await first.closeCode).toBe(1000);
    const second = await server.next();
    await until(() => opened(events, 2));
    relay.send(1, "x");
    relay.close(1, 1000);
    await new Promise((r) => setTimeout(r, 50));
    expect(second.socket.readyState).toBe(1);
    relay.send(2, "y");
    await until(() => second.received.length === 1);
    expect(first.received).toEqual([]);
    expect(second.received).toEqual(["y"]);
  });

  it("4001 de conexão trocada ou fechada pela página não vale como sessão expirada", async () => {
    const server = await fakeServer();
    const { relay, events, onUnauthorized } = makeRelay();
    relay.open(1, { url: server.url, session: "s1", anchor: null });
    const first = await server.next();
    await until(() => opened(events, 1));
    first.socket.close(4001);
    relay.open(2, { url: server.url, session: "s1", anchor: null });
    await until(() => events.some(([id, e]) => id === 1 && e.type === "close"));
    const second = await server.next();
    await until(() => opened(events, 2));
    relay.close(2, 4001);
    await second.closeCode;
    await until(() => events.some(([id, e]) => id === 2 && e.type === "close"));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("sem sessão não vai à rede", async () => {
    const server = await fakeServer();
    const { relay, events, onUnauthorized } = makeRelay();
    relay.open(3, { url: server.url, session: null, anchor: null });
    relay.open(4, null);
    expect(events).toEqual([
      [3, { type: "close", code: 4001 }],
      [4, { type: "close", code: 4001 }],
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.conns).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("código de fechamento inválido vira 1000", async () => {
    const server = await fakeServer();
    const { relay, events } = makeRelay();
    relay.open(1, { url: server.url, session: "s1", anchor: null });
    const conn = await server.next();
    await until(() => opened(events, 1));
    relay.close(1, 5);
    expect(await conn.closeCode).toBe(1000);
  });
});

describe("SocketRelay com âncora", () => {
  const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/tls/${name}`, import.meta.url)), "utf8");

  async function wssOffice(): Promise<string> {
    const https = createHttpsServer({ key: fixture("a.key"), cert: fixture("a.crt") });
    await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
    const wss = new WebSocketServer({ server: https });
    servers.push(Object.assign(wss, { close: ((cb?: () => void) => { https.closeAllConnections(); https.close(() => cb?.()); }) as WebSocketServer["close"] }));
    return `https://127.0.0.1:${(https.address() as AddressInfo).port}`;
  }

  it("confia só na âncora do escritório: a certa conecta, a de outro certificado cai com 1006", async () => {
    const url = await wssOffice();
    const good = makeRelay();
    good.relay.open(1, { url, session: "s1", anchor: fixture("a.crt") });
    await until(() => opened(good.events, 1));
    const bad = makeRelay();
    bad.relay.open(1, { url, session: "s1", anchor: fixture("b.crt") });
    await until(() => bad.events.some(([, e]) => e.type === "close"));
    expect(opened(bad.events, 1)).toBe(false);
  });
});
