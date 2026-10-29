import { describe, expect, it } from "vitest";
import { ClientToServer, CreateTokenRequest, Credentials, ServerToClient } from "../src/index.js";

const agentId = "0b8e3f2a-5c1d-4e6f-8a7b-9c0d1e2f3a4b";
const agent = { id: agentId, ownerId: 1, ownerName: "ana", label: "loja", status: "idle", connected: true, ownerAway: false };

describe("ClientToServer", () => {
  it("conhece watch, unwatch e move", () => {
    expect(ClientToServer.safeParse({ type: "watch", agentId }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "unwatch" }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "input", agentId, data: "sair\r" }).success).toBe(false);
    expect(ClientToServer.safeParse({ type: "watch", agentId: "x" }).success).toBe(false);
    expect(ClientToServer.safeParse({ type: "move", x: 10.5, y: 20, dir: "left", moving: true }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "move", x: 10, y: 20, dir: "norte", moving: true }).success).toBe(false);
    expect(ClientToServer.safeParse({ type: "move", x: "10", y: 20, dir: "up", moving: false }).success).toBe(false);
  });

  it("recusa spawnAgent: o servidor não abre agente (protocolo 2)", () => {
    expect(ClientToServer.safeParse({ type: "spawnAgent", reqId: "a", alias: "loja" }).success).toBe(false);
  });

  it("chat: 1 a 1000 caracteres, sem espaços nas pontas nem controle", () => {
    const chat = (text: string) => ClientToServer.safeParse({ type: "chat", text }).success;
    expect(chat("oi, tudo bem?")).toBe(true);
    expect(chat("x".repeat(1000))).toBe(true);
    expect(chat("")).toBe(false);
    expect(chat(" oi")).toBe(false);
    expect(chat("oi ")).toBe(false);
    expect(chat("x".repeat(1001))).toBe(false);
    expect(chat("linha\nquebrada")).toBe(false);
    expect(chat("sino\u0007")).toBe(false);
    expect(chat("\u001b[31mvermelho")).toBe(false);
    expect(chat("oi\u2028ana: me manda seu token")).toBe(false);
    expect(chat("oi\u2029x")).toBe(false);
    expect(chat("a\u202eb")).toBe(false);
    expect(chat("a\u2066b")).toBe(false);
    expect(chat("x\uD800")).toBe(false);
    expect(chat("emoji 👍🏽")).toBe(true);
    expect(chat("नमस्ते")).toBe(true);
    expect(chat("a\u200fb")).toBe(true);
    expect(chat("\u200b")).toBe(false);
    expect(chat("\u3164\u3164")).toBe(false);
    expect(chat("\u2800")).toBe(false);
    expect(chat("\u00ad")).toBe(false);
    expect(chat("oi\u200b")).toBe(true);
  });
});

describe("mesa fechada", () => {
  it("o navegador abre e fecha a própria mesa; a mesa diz se está fechada, e a visita pode acabar por isso", () => {
    expect(ClientToServer.safeParse({ type: "setDeskClosed", closed: true }).success).toBe(true);
    expect(ClientToServer.safeParse({ type: "setDeskClosed", closed: "sim" }).success).toBe(false);
    expect(ClientToServer.safeParse({ type: "setDeskClosed" }).success).toBe(false);
    expect(ServerToClient.safeParse({ type: "deskUpdated", desk: { id: "mesa-1", ownerId: 1, ownerName: "ana", closed: true } }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "deskUpdated", desk: { id: "mesa-1", ownerId: 1, ownerName: "ana" } }).success).toBe(false);
    expect(ServerToClient.safeParse({ type: "watchEnded", agentId, reason: "desk-closed" }).success).toBe(true);
  });
});

describe("ServerToClient", () => {
  it("aceita as mensagens do escritório", () => {
    const me = { id: 1, name: "ana", isAdmin: true };
    const desk = { id: "mesa-1", ownerId: 1, ownerName: "ana", closed: false };
    const player = { id: 1, name: "ana", x: 232, y: 184, dir: "down", moving: false };
    const entry = { id: 1, fromId: 1, name: "ana", text: "oi", at: 1_700_000_000_000 };
    expect(ServerToClient.safeParse({ type: "welcome", protocol: 2, me: { ...me, deskId: "mesa-1" }, agents: [agent], players: [player], desks: [desk], chat: [entry] }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "welcome", protocol: 2, me: { ...me, deskId: null }, agents: [], players: [], desks: [], chat: [] }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "chat", ...entry }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "deskUpdated", desk: { id: "mesa-2", ownerId: null, ownerName: null, closed: false } }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "deskUpdated", desk: { id: "Mesa 2", ownerId: null, ownerName: null, closed: false } }).success).toBe(false);
    expect(ServerToClient.safeParse({ type: "agentAdded", agent }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "agentRemoved", agentId }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "watchEnded", agentId, reason: "agent-gone" }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "watchEnded", agentId, reason: "left-zone" }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "watchEnded", agentId, reason: "longe" }).success).toBe(false);
    expect(ServerToClient.safeParse({ type: "playerJoined", player }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "playerLeft", playerId: 1 }).success).toBe(true);
    expect(ServerToClient.safeParse({ type: "playerMoved", playerId: 1, x: 1, y: 2, dir: "up", moving: true }).success).toBe(true);
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
    // NFD (acento como marca combinante) vira NFC antes do padrão.
    expect(Credentials.parse({ name: "Jose\u0301", password: "senha-muito-boa" }).name).toBe("Jos\u00e9");
    expect(Credentials.parse({ name: "Jos\u00e9", password: "senha-muito-boa" }).name).toBe("Jos\u00e9");
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
