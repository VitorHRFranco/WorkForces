import { describe, expect, it } from "vitest";
import { ClientToServer, CreateTokenRequest, Credentials, ServerToClient } from "../src/index.js";

const agentId = "0b8e3f2a-5c1d-4e6f-8a7b-9c0d1e2f3a4b";
const agent = { id: agentId, ownerId: 1, ownerName: "ana", label: "loja", status: "idle", connected: true };

describe("ClientToServer", () => {
  it("só conhece watch e unwatch", () => {
    expect(ClientToServer.safeParse({ type: "watch", agentId }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "unwatch" }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "input", agentId, data: "sair\r" }).success).toBe(false);
    expect(ClientToServer.safeParse({ type: "watch", agentId: "x" }).success).toBe(false);
  });
});

describe("ServerToClient", () => {
  it("aceita as mensagens do escritório", () => {
    const me = { id: 1, name: "ana", isAdmin: true };
    expect(ServerToClient.safeParse({ type: "welcome", protocol: 1, me, agents: [agent] }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "agentAdded", agent }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "agentRemoved", agentId }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "watchEnded", agentId, reason: "agent-gone" }).success).toBe(true);
  });

  it("valida os limites do quadro", () => {
    const frame = { type: "frame", agentId, seq: 1, key: true, cols: 10, rows: 2, cursor: { x: 0, y: 0, visible: true }, lines: [[0, "oi"]] };
    expect(ServerToClient.safeParse(frame).success).toBe(true);
    expect(ServerToClient.safeParse({ ...frame, lines: [[5, "x"]] }).success).toBe(false);
  });
});

describe("Credentials e CreateTokenRequest", () => {
  it("aplica as regras de nome e senha", () => {
    expect(Credentials.safeParse({ name: "ana.souza", password: "senha-forte-1" }).success).toBe(true);
    expect(Credentials.safeParse({ name: "João_2", password: "senha-forte-1" }).success).toBe(true);
    expect(Credentials.safeParse({ name: "a", password: "senha-forte-1" }).success).toBe(false);
    expect(Credentials.safeParse({ name: "ana souza", password: "senha-forte-1" }).success).toBe(false);
    expect(Credentials.safeParse({ name: "ana", password: "curta" }).success).toBe(false);
  });

  it("nome de token tem 1 a 40 caracteres", () => {
    expect(CreateTokenRequest.parse({ name: "  notebook  " })).toEqual({ name: "notebook" });
    expect(CreateTokenRequest.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateTokenRequest.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
});
