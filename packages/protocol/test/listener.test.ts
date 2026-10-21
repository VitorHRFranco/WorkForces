import { describe, expect, it } from "vitest";
import {
  BridgeHello,
  ListenerToServer,
  MAX_ALIASES,
  ServerToClient,
  ServerToListener,
  SpawnAgent,
  SpawnError,
} from "../src/index.js";

const ok = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("ouvinte (workforces ponte)", () => {
  it("hello com a lista de apelidos; o kind separa ouvinte de agente", () => {
    expect(ok(BridgeHello, { type: "hello", protocol: 1, kind: "listener", aliases: ["loja", "site-2"] })).toBe(true);
    expect(ok(BridgeHello, { type: "hello", protocol: 1, kind: "listener", aliases: [] })).toBe(true);
    expect(ok(BridgeHello, { type: "hello", protocol: 1, kind: "outro", aliases: [] })).toBe(false);
    const agent = { type: "hello", protocol: 1, kind: "agent", agentId: "00000000-0000-4000-8000-000000000001", label: "loja", cols: 80, rows: 24 };
    expect(BridgeHello.parse(agent).kind).toBe("agent");
  });

  it("recusa apelido fora do padrão, repetido ou lista grande demais", () => {
    const hello = (aliases: unknown) => ok(ListenerToServer, { type: "hello", protocol: 1, kind: "listener", aliases });
    expect(hello(["Loja"])).toBe(false);
    expect(hello(["-loja"])).toBe(false);
    expect(hello(["c:\\proj\\loja"])).toBe(false);
    expect(hello(["a".repeat(33)])).toBe(false);
    expect(hello(["loja", "loja"])).toBe(false);
    expect(hello(Array.from({ length: MAX_ALIASES }, (_, i) => `p${i}`))).toBe(true);
    expect(hello(Array.from({ length: MAX_ALIASES + 1 }, (_, i) => `p${i}`))).toBe(false);
    expect(ok(ListenerToServer, { type: "aliases", aliases: ["loja"] })).toBe(true);
  });

  it("o servidor só manda spawn com reqId e apelido; o resultado traz o motivo só quando falha", () => {
    expect(ok(ServerToListener, { type: "spawn", reqId: "r-1", alias: "loja" })).toBe(true);
    expect(ok(ServerToListener, { type: "spawn", reqId: "r-1", alias: "loja", path: "C:\\x" })).toBe(true); // campo extra é descartado
    expect(ServerToListener.parse({ type: "spawn", reqId: "r-1", alias: "loja", path: "C:\\x" })).toEqual({ type: "spawn", reqId: "r-1", alias: "loja" });
    expect(ok(ServerToListener, { type: "spawn", reqId: "r 1", alias: "loja" })).toBe(false);
    expect(ok(ServerToListener, { type: "spawn", reqId: "x".repeat(41), alias: "loja" })).toBe(false);
    expect(ok(ListenerToServer, { type: "spawnResult", reqId: "r-1", ok: true })).toBe(true);
    expect(ok(ListenerToServer, { type: "spawnResult", reqId: "r-1", ok: false, error: "folder-missing" })).toBe(true);
    expect(ok(ListenerToServer, { type: "spawnResult", reqId: "r-1", ok: false })).toBe(false);
    expect(ok(ListenerToServer, { type: "spawnResult", reqId: "r-1", ok: true, error: "timeout" })).toBe(false);
    expect(ok(ListenerToServer, { type: "spawnResult", reqId: "r-1", ok: false, error: "explodiu" })).toBe(false);
  });
});

describe("chamar agente pelo navegador", () => {
  it("o navegador pede com reqId e apelido; o servidor manda as pastas e o resultado", () => {
    expect(ok(SpawnAgent, { type: "spawnAgent", reqId: "s1-2", alias: "loja" })).toBe(true);
    expect(ok(SpawnAgent, { type: "spawnAgent", reqId: "s1-2", alias: "../loja" })).toBe(false);
    expect(ok(ServerToClient, { type: "aliases", aliases: ["loja"], listenerOnline: true })).toBe(true);
    expect(ok(ServerToClient, { type: "aliases", aliases: [], listenerOnline: false })).toBe(true);
    expect(ok(ServerToClient, { type: "spawnResult", reqId: "s1-2", ok: false, error: "no-listener" })).toBe(true);
    expect(SpawnError.options).toContain("timeout");
  });
});
