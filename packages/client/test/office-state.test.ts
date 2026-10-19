import type { AgentInfo, ServerToClient } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { OfficeState } from "../src/office/office-state";

const agent = (id: string, ownerId: number, label: string): AgentInfo => ({
  id,
  ownerId,
  ownerName: ownerId === 1 ? "ana" : "bia",
  label,
  status: "idle",
  connected: true,
  ownerAway: false,
});
const A1 = "0b8e3f2a-5c1d-4e6f-8a7b-9c0d1e2f3a4b";
const A2 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const A3 = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

const welcome = (): ServerToClient => ({
  type: "welcome",
  protocol: 1,
  me: { id: 1, name: "ana", isAdmin: true, deskId: "mesa-1" },
  players: [{ id: 1, name: "ana", x: 232, y: 184, dir: "down", moving: false }],
  agents: [agent(A1, 1, "loja"), agent(A2, 1, "api"), agent(A3, 2, "site")],
  desks: [
    { id: "mesa-1", ownerId: 1, ownerName: "ana" },
    { id: "mesa-2", ownerId: 2, ownerName: "bia" },
    { id: "mesa-3", ownerId: null, ownerName: null },
  ],
  chat: [{ id: 1, fromId: 2, name: "bia", text: "oi", at: 1 }],
});

describe("OfficeState", () => {
  it("monta tudo a partir do welcome e avisa quem assina", () => {
    const state = new OfficeState();
    let calls = 0;
    const unsubscribe = state.subscribe(() => calls++);
    state.apply(welcome());
    expect(state.me?.deskId).toBe("mesa-1");
    expect(state.players.get(1)?.x).toBe(232);
    expect(state.agents.size).toBe(3);
    expect(state.desks.get("mesa-2")?.ownerName).toBe("bia");
    expect(state.chat.map((entry) => entry.text)).toEqual(["oi"]);
    expect(calls).toBe(1);
    expect(state.version).toBe(1);
    unsubscribe();
    state.apply({ type: "playerLeft", playerId: 1 });
    expect(calls).toBe(1);
  });

  it("acompanha jogadores, agentes, mesas e chat; quadros não mexem no estado", () => {
    const state = new OfficeState();
    state.apply(welcome());
    state.apply({ type: "playerJoined", player: { id: 2, name: "bia", x: 10, y: 10, dir: "down", moving: false } });
    state.apply({ type: "playerMoved", playerId: 2, x: 50, y: 60, dir: "left", moving: true });
    state.apply({ type: "playerMoved", playerId: 99, x: 1, y: 1, dir: "up", moving: true });
    expect(state.players.get(2)).toMatchObject({ x: 50, y: 60, dir: "left", moving: true });
    expect(state.players.has(99)).toBe(false);
    state.apply({ type: "agentUpdated", agent: { ...agent(A3, 2, "site"), ownerAway: true } });
    expect(state.agents.get(A3)?.ownerAway).toBe(true);
    state.apply({ type: "agentRemoved", agentId: A2 });
    expect(state.agents.has(A2)).toBe(false);
    state.apply({ type: "deskUpdated", desk: { id: "mesa-1", ownerId: null, ownerName: null } });
    state.apply({ type: "deskUpdated", desk: { id: "mesa-3", ownerId: 1, ownerName: "ana" } });
    expect(state.me?.deskId).toBe("mesa-3");
    const version = state.version;
    state.apply({ type: "frame", agentId: A1, seq: 1, key: true, cols: 2, rows: 1, cursor: { x: 0, y: 0, visible: true }, lines: [[0, "oi"]] });
    state.apply({ type: "watchEnded", agentId: A1, reason: "agent-gone" });
    expect(state.version).toBe(version);
  });

  it("guarda no máximo 200 mensagens de chat", () => {
    const state = new OfficeState();
    state.apply(welcome());
    for (let i = 2; i <= 210; i++) state.apply({ type: "chat", id: i, fromId: 1, name: "ana", text: `m${i}`, at: i });
    expect(state.chat).toHaveLength(200);
    expect(state.chat[0]?.id).toBe(11);
    expect(state.chat.at(-1)).toEqual({ id: 210, fromId: 1, name: "ana", text: "m210", at: 210 });
  });

  it("agentes de uma mesa, na ordem do rótulo; mesa livre ou desconhecida não tem agentes", () => {
    const state = new OfficeState();
    state.apply(welcome());
    expect(state.agentsAtDesk("mesa-1").map((a) => a.label)).toEqual(["api", "loja"]);
    expect(state.agentsAtDesk("mesa-2").map((a) => a.label)).toEqual(["site"]);
    expect(state.agentsAtDesk("mesa-3")).toEqual([]);
    expect(state.agentsAtDesk("mesa-9")).toEqual([]);
  });
});
