import type { AgentHello, FrameBody, ServerToClient } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { Hub, SLOW_VIEWER_BYTES, type BridgeLink, type ClientLink } from "../src/realtime/hub.js";

const AGENT = "0b8e3f2a-5c1d-4e6f-8a7b-9c0d1e2f3a4b";
const ana = { id: 1, name: "ana" };
const bia = { id: 2, name: "bia" };

class FakeBridge implements BridgeLink {
  readonly viewers: number[] = [];
  readonly closed: [number, string][] = [];
  constructor(readonly tokenId = 1) {}
  sendViewers(n: number): void {
    this.viewers.push(n);
  }
  close(code: number, reason: string): void {
    this.closed.push([code, reason]);
  }
}

class FakeClient implements ClientLink {
  readonly messages: ServerToClient[] = [];
  buffered = 0;
  constructor(readonly userId = 1) {}
  send(message: ServerToClient): void {
    this.messages.push(message);
  }
  bufferedAmount(): number {
    return this.buffered;
  }
  frames() {
    return this.messages.filter((m): m is Extract<ServerToClient, { type: "frame" }> => m.type === "frame");
  }
  types() {
    return this.messages.map((m) => m.type);
  }
}

const hello = (label = "loja"): AgentHello => ({ type: "hello", protocol: 1, kind: "agent", agentId: AGENT, label, cols: 10, rows: 2 });
const frame = (seq: number, key: boolean, lines: [number, string][]): FrameBody => ({
  seq,
  key,
  cols: 10,
  rows: 2,
  cursor: { x: 0, y: 0, visible: true },
  lines,
});

describe("Hub", () => {
  it("anuncia agentes e recusa agentId de outro dono", () => {
    const hub = new Hub();
    const client = new FakeClient();
    hub.addClient(client);
    expect(hub.registerAgent(ana, hello(), new FakeBridge())).toEqual({ ok: true });
    expect(client.messages).toEqual([
      { type: "agentAdded", agent: { id: AGENT, ownerId: 1, ownerName: "ana", label: "loja", status: "idle", connected: true, ownerAway: false } },
    ]);
    expect(hub.registerAgent(bia, hello(), new FakeBridge(2))).toEqual({ ok: false, reason: "agent-id-taken" });
    expect(hub.addClient(new FakeClient(3))).toHaveLength(1);
  });

  it("agente de quem não está com o escritório aberto aparece como dono fora", () => {
    const hub = new Hub();
    const watcher = new FakeClient(bia.id);
    hub.addClient(watcher);
    hub.registerAgent(ana, hello(), new FakeBridge());
    expect(watcher.messages.at(-1)).toMatchObject({ type: "agentAdded", agent: { ownerAway: true } });
    const firstTab = new FakeClient(ana.id);
    hub.addClient(firstTab);
    expect(watcher.messages.at(-1)).toMatchObject({ type: "agentUpdated", agent: { ownerAway: false } });
    // Segunda aba entra antes de a primeira sair: não pisca "dono fora".
    const secondTab = new FakeClient(ana.id);
    hub.addClient(secondTab);
    hub.removeClient(firstTab);
    expect(watcher.messages.filter((m) => m.type === "agentUpdated")).toHaveLength(1);
    hub.removeClient(secondTab);
    expect(watcher.messages.at(-1)).toMatchObject({ type: "agentUpdated", agent: { ownerAway: true } });
    hub.removeClient(secondTab);
    expect(watcher.messages.filter((m) => m.type === "agentUpdated")).toHaveLength(2);
  });

  it("nova conexão do mesmo dono substitui a antiga", () => {
    const hub = new Hub();
    const old = new FakeBridge();
    hub.registerAgent(ana, hello(), old);
    const fresh = new FakeBridge();
    hub.registerAgent(ana, hello("loja-2"), fresh);
    expect(old.closed).toHaveLength(1);
    expect(hub.addClient(new FakeClient())[0]?.label).toBe("loja-2");
    hub.agentStatus(old, AGENT, "working");
    expect(hub.addClient(new FakeClient())[0]?.status).toBe("idle");
  });

  it("primeiro visitante pede quadros; o segundo recebe a tela guardada na hora", () => {
    const hub = new Hub();
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    hub.agentFrame(bridge, AGENT, frame(1, true, [[0, "ignorado"], [1, ""]]));
    const first = new FakeClient();
    hub.addClient(first);
    expect(hub.watch(first, AGENT)).toBe(true);
    expect(bridge.viewers).toEqual([1]);
    expect(first.frames()).toEqual([]);
    hub.agentFrame(bridge, AGENT, frame(5, false, [[0, "diff antes do chave"]]));
    expect(first.frames()).toEqual([]);
    hub.agentFrame(bridge, AGENT, frame(6, true, [[0, "OLÁ"], [1, ""]]));
    hub.agentFrame(bridge, AGENT, frame(7, false, [[1, "linha 2"]]));
    expect(first.frames().map((f) => f.seq)).toEqual([6, 7]);
    const second = new FakeClient(2);
    hub.addClient(second);
    hub.watch(second, AGENT);
    expect(bridge.viewers).toEqual([1, 2]);
    expect(second.frames()).toEqual([
      { type: "frame", agentId: AGENT, seq: 7, key: true, cols: 10, rows: 2, cursor: { x: 0, y: 0, visible: true }, lines: [[0, "OLÁ"], [1, "linha 2"]] },
    ]);
  });

  it("sem visitantes a tela guardada é descartada", () => {
    const hub = new Hub();
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const client = new FakeClient();
    hub.addClient(client);
    hub.watch(client, AGENT);
    hub.agentFrame(bridge, AGENT, frame(1, true, [[0, "segredo de antes"], [1, ""]]));
    hub.unwatch(client);
    expect(bridge.viewers).toEqual([1, 0]);
    const later = new FakeClient(2);
    hub.addClient(later);
    hub.watch(later, AGENT);
    expect(later.frames()).toEqual([]);
  });

  it("visitante lento pula diffs e recebe quadro-chave quando a fila esvazia", () => {
    const hub = new Hub();
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const slow = new FakeClient();
    hub.addClient(slow);
    hub.watch(slow, AGENT);
    hub.agentFrame(bridge, AGENT, frame(1, true, [[0, "a"], [1, ""]]));
    slow.buffered = SLOW_VIEWER_BYTES + 1;
    hub.agentFrame(bridge, AGENT, frame(2, false, [[0, "b"]]));
    hub.agentFrame(bridge, AGENT, frame(3, false, [[0, "c"]]));
    expect(slow.frames().map((f) => f.seq)).toEqual([1]);
    slow.buffered = 0;
    hub.agentFrame(bridge, AGENT, frame(4, false, [[1, "d"]]));
    expect(slow.frames().at(-1)).toMatchObject({ seq: 4, key: true, lines: [[0, "c"], [1, "d"]] });
  });

  it("quando a ponte cai, o agente fica 'reconectando' e some depois do prazo", async () => {
    const hub = new Hub(20);
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const client = new FakeClient();
    hub.addClient(client);
    hub.watch(client, AGENT);
    hub.agentDisconnected(bridge, AGENT);
    expect(client.messages.at(-1)).toMatchObject({ type: "agentUpdated", agent: { connected: false } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.types().slice(-2)).toEqual(["watchEnded", "agentRemoved"]);
    expect(hub.addClient(new FakeClient(2))).toEqual([]);
  });

  it("agentEnded remove o agente na hora, mas só para a ponte atual", () => {
    const hub = new Hub(60_000);
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const client = new FakeClient();
    hub.addClient(client);
    hub.watch(client, AGENT);
    hub.agentEnded(bridge, AGENT);
    expect(client.types().slice(-2)).toEqual(["watchEnded", "agentRemoved"]);
    expect(hub.addClient(new FakeClient(2))).toEqual([]);

    const old = new FakeBridge();
    hub.registerAgent(ana, hello(), old);
    const fresh = new FakeBridge();
    hub.registerAgent(ana, hello(), fresh);
    hub.agentEnded(old, AGENT);
    expect(hub.addClient(new FakeClient(3))).toHaveLength(1);
  });

  it("reconectar dentro do prazo mantém o agente e pede quadros de novo", async () => {
    const hub = new Hub(30);
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const client = new FakeClient();
    hub.addClient(client);
    hub.watch(client, AGENT);
    hub.agentDisconnected(bridge, AGENT);
    const again = new FakeBridge();
    hub.registerAgent(ana, hello(), again);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(again.viewers).toEqual([1]);
    expect(client.types()).not.toContain("agentRemoved");
  });

  it("revogar um token fecha só as pontes dele", () => {
    const hub = new Hub();
    const mine = new FakeBridge(7);
    const other = new FakeBridge(8);
    hub.registerAgent(ana, hello(), mine);
    hub.registerAgent(ana, { ...hello(), agentId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }, other);
    const watcher = new FakeClient();
    hub.addClient(watcher);
    hub.watch(watcher, AGENT);
    hub.closeBridgesForToken(7);
    expect(mine.closed).toEqual([[4001, "token revogado"]]);
    expect(other.closed).toEqual([]);
    expect(watcher.messages.at(-1)).toMatchObject({ type: "agentUpdated", agent: { connected: false } });
  });

  it("watch de agente que não existe cancela o anterior", () => {
    const hub = new Hub();
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const client = new FakeClient();
    hub.addClient(client);
    hub.watch(client, AGENT);
    expect(hub.watch(client, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f")).toBe(false);
    expect(bridge.viewers).toEqual([1, 0]);
  });

  it("visitante lento recebe a tela quando a fila esvazia, mesmo sem novos quadros", async () => {
    const hub = new Hub(30_000, 20);
    const bridge = new FakeBridge();
    hub.registerAgent(ana, hello(), bridge);
    const slow = new FakeClient();
    hub.addClient(slow);
    hub.watch(slow, AGENT);
    hub.agentFrame(bridge, AGENT, frame(1, true, [[0, "a"], [1, ""]]));
    slow.buffered = SLOW_VIEWER_BYTES + 1;
    hub.agentFrame(bridge, AGENT, frame(2, false, [[0, "b"]]));
    slow.buffered = 0;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(slow.frames().at(-1)).toMatchObject({ seq: 2, key: true, lines: [[0, "b"], [1, ""]] });
  });
});
