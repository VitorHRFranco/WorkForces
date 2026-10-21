import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficeConnection } from "../src/office/connection";
import { SEND_LIMITS } from "../src/office/send-budget";

/** WebSocket de mentira, já aberto: guarda o que a conexão manda. */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readonly readyState = 1;
  readonly sent: { type: string; agentId?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor() {
    FakeSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {}
}

const handlers = { onMessage: () => {}, onStatus: () => {}, onEnd: () => {} };
const watches = () => FakeSocket.last!.sent.filter((message) => message.type === "watch");

/** Gasta as vagas de watch/unwatch do segundo (o unwatch conta no mesmo limite). */
function exhaust(connection: OfficeConnection): void {
  for (let i = 0; i < SEND_LIMITS.watch; i++) connection.unwatch();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { protocol: "http:", host: "localhost" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OfficeConnection: watch descartado pelo limite", () => {
  it("é refeito sozinho quando abre vaga", () => {
    const connection = new OfficeConnection(handlers);
    connection.start();
    exhaust(connection);
    connection.watch("agente-1");
    expect(watches()).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(watches()).toEqual([{ type: "watch", agentId: "agente-1" }]);
    connection.stop();
  });

  it("um watch mais novo substitui o pendente", () => {
    const connection = new OfficeConnection(handlers);
    connection.start();
    exhaust(connection);
    connection.watch("agente-1");
    connection.watch("agente-2");
    vi.advanceTimersByTime(1_000);
    expect(watches()).toEqual([{ type: "watch", agentId: "agente-2" }]);
    connection.stop();
  });

  it("unwatch e stop cancelam o pendente", () => {
    const connection = new OfficeConnection(handlers);
    connection.start();
    exhaust(connection);
    connection.watch("agente-1");
    connection.unwatch();
    vi.advanceTimersByTime(2_000);
    expect(watches()).toEqual([]);
    exhaust(connection);
    connection.watch("agente-2");
    connection.stop();
    vi.advanceTimersByTime(2_000);
    expect(watches()).toEqual([]);
  });
});
