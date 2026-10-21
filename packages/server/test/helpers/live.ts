import type { AddressInfo } from "node:net";
import WebSocket, { type ClientOptions } from "ws";
import { createServer } from "../../src/server.js";
import { ORIGIN, testConfig } from "./setup.js";
import { waitUntil } from "./wait.js";

export async function startLiveServer(options: { sweepMs?: number; helloTimeoutMs?: number; graceMs?: number; heartbeatMs?: number; now?: () => number } = {}) {
  const logs: string[] = [];
  const server = createServer(testConfig(), {
    dbFile: ":memory:",
    log: (message) => logs.push(message),
    graceMs: options.graceMs ?? 50,
    now: options.now,
    sockets: { sweepMs: options.sweepMs ?? 60_000, helloTimeoutMs: options.helloTimeoutMs ?? 5_000, heartbeatMs: options.heartbeatMs },
  });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const port = (server.app.server.address() as AddressInfo).port;
  return { ...server, logs, wsBase: `ws://127.0.0.1:${port}` };
}

export type LiveServer = Awaited<ReturnType<typeof startLiveServer>>;
export type Message = Record<string, unknown>;

export class TestSocket {
  readonly ws: WebSocket;
  readonly messages: Message[] = [];
  readonly closed: Promise<number>;

  constructor(url: string, options: ClientOptions = {}) {
    this.ws = new WebSocket(url, options);
    this.ws.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as Message));
    this.ws.on("error", () => {});
    this.closed = new Promise((resolve) => this.ws.on("close", (code) => resolve(code)));
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once("open", () => resolve());
      this.ws.once("close", () => reject(new Error("fechou antes de abrir")));
    });
  }

  send(value: unknown): void {
    this.ws.send(typeof value === "string" ? value : JSON.stringify(value));
  }

  async waitFor(predicate: (message: Message) => boolean, what: string): Promise<Message> {
    await waitUntil(() => this.messages.some(predicate), 5000, what);
    return this.messages.find(predicate)!;
  }
}

export const bridgeSocket = (server: LiveServer, token: string) =>
  new TestSocket(`${server.wsBase}/ws/bridge`, { headers: { authorization: `Bearer ${token}` } });

export const clientSocket = (server: LiveServer, sessionId: string, origin = ORIGIN) =>
  new TestSocket(`${server.wsBase}/ws/client`, { headers: { cookie: `wf_session=${sessionId}` }, origin });

export const hello = (agentId: string, label = "loja") => ({ type: "hello", protocol: 1, kind: "agent", agentId, label, cols: 20, rows: 2 });
