import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { disableUser } from "../src/accounts/index.js";
import { bridgeSocket, clientSocket, hello, startLiveServer, type LiveServer, type Message } from "./helpers/live.js";
import { JSON_HEADERS, createUser } from "./helpers/setup.js";

const servers: LiveServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.app.close();
});

async function live(options?: Parameters<typeof startLiveServer>[0]) {
  const server = await startLiveServer(options);
  servers.push(server);
  return server;
}

async function person(server: LiveServer, name: string) {
  const user = await createUser(server.accounts, name);
  return { user, session: server.accounts.sessions.create(user.id), token: server.accounts.tokens.create(user.id, "notebook") };
}

const keyFrame = (seq: number, text: string) => ({
  type: "frame",
  seq,
  key: true,
  cols: 20,
  rows: 2,
  cursor: { x: 0, y: 0, visible: true },
  lines: [[0, text], [1, ""]],
});

const knowsAgent = (agentId: string) => (m: Message) =>
  (m.type === "welcome" && (m.agents as Message[]).some((a) => a.id === agentId)) ||
  (m.type === "agentAdded" && (m.agent as Message).id === agentId);

describe("conexão da ponte", () => {
  it("token inválido fecha com 4001 depois do upgrade", async () => {
    const server = await live();
    expect(await bridgeSocket(server, "wf_errado").closed).toBe(4001);
  });

  it("versão diferente fecha com 4002; mensagem inválida e falta de hello, com 4000", async () => {
    const server = await live({ helloTimeoutMs: 100 });
    const { token } = await person(server, "ana");
    const old = bridgeSocket(server, token.token);
    await old.opened();
    old.send({ ...hello(randomUUID()), protocol: 99 });
    expect(await old.closed).toBe(4002);
    const garbage = bridgeSocket(server, token.token);
    await garbage.opened();
    garbage.send("{");
    expect(await garbage.closed).toBe(4000);
    const silent = bridgeSocket(server, token.token);
    expect(await silent.closed).toBe(4000);
  });

  it("pedido de upgrade malformado não derruba o servidor", async () => {
    const server = await live();
    const port = Number(new URL(server.wsBase).port);
    const raw = connect(port, "127.0.0.1");
    raw.on("error", () => {});
    const ended = new Promise<void>((resolve) => {
      raw.on("close", () => resolve());
      setTimeout(resolve, 500);
    });
    raw.write("GET //[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await ended;
    raw.destroy();
    expect((await server.app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect(await bridgeSocket(server, "wf_errado").closed).toBe(4001);
  });

  it("recusa agentId de outra pessoa", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const agentId = randomUUID();
    const mine = bridgeSocket(server, ana.token.token);
    await mine.opened();
    mine.send(hello(agentId));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor(knowsAgent(agentId), "agente da ana");
    const thief = bridgeSocket(server, bia.token.token);
    await thief.opened();
    thief.send(hello(agentId, "roubado"));
    expect(await thief.closed).toBe(4000);
    expect(viewer.messages.some((m) => m.type === "agentUpdated")).toBe(false);
  });

  it("mensagens demais fecham com 4008", async () => {
    const server = await live();
    const { token } = await person(server, "ana");
    const bridge = bridgeSocket(server, token.token);
    await bridge.opened();
    bridge.send(hello(randomUUID()));
    for (let i = 0; i < 150; i++) bridge.send({ type: "status", state: i % 2 ? "working" : "idle" });
    expect(await bridge.closed).toBe(4008);
  });
});

describe("conexão do navegador", () => {
  it("exige a origem do escritório e uma sessão válida", async () => {
    const server = await live();
    const { session } = await person(server, "ana");
    expect(await clientSocket(server, session, "https://malicioso.exemplo").closed).toBe(4003);
    expect(await clientSocket(server, "sessao-falsa").closed).toBe(4001);
  });

  it("uma segunda aba fecha a primeira com 4009", async () => {
    const server = await live();
    const { session } = await person(server, "ana");
    const first = clientSocket(server, session);
    await first.waitFor((m) => m.type === "welcome", "welcome da primeira");
    const second = clientSocket(server, session);
    await second.waitFor((m) => m.type === "welcome", "welcome da segunda");
    expect(await first.closed).toBe(4009);
    expect(second.ws.readyState).toBe(second.ws.OPEN);
  });
});

describe("repasse de quadros", () => {
  it("o visitante vê a tela e nada do que ele manda chega à ponte", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));

    const viewer = clientSocket(server, bia.session);
    await viewer.waitFor(knowsAgent(agentId), "agente na lista");
    viewer.send({ type: "watch", agentId });
    await bridge.waitFor((m) => m.type === "viewers" && m.n === 1, "viewers 1");
    bridge.send(keyFrame(1, "OLÁ"));
    const received = await viewer.waitFor((m) => m.type === "frame" && m.seq === 1, "quadro 1");
    expect(received).toMatchObject({ agentId, key: true, lines: [[0, "OLÁ"], [1, ""]] });

    const late = clientSocket(server, ana.session);
    await late.waitFor((m) => m.type === "welcome", "welcome");
    late.send({ type: "watch", agentId });
    await late.waitFor((m) => m.type === "frame" && m.key === true && m.seq === 1, "tela guardada");
    await bridge.waitFor((m) => m.type === "viewers" && m.n === 2, "viewers 2");

    viewer.send({ type: "input", agentId, data: "sair\r" });
    expect(await viewer.closed).toBe(4000);
    await bridge.waitFor(() => bridge.messages.filter((m) => m.n === 1).length === 2, "viewers volta a 1");
    expect(bridge.messages.every((m) => m.type === "viewers")).toBe(true);
  });

  it("revogar o token pela API derruba a ponte com 4001", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor(knowsAgent(agentId), "agente da ana");
    const response = await server.app.inject({
      method: "DELETE",
      url: `/api/tokens/${ana.token.id}`,
      headers: { ...JSON_HEADERS, cookie: `wf_session=${ana.session}` },
      payload: {},
    });
    expect(response.statusCode).toBe(204);
    expect(await bridge.closed).toBe(4001);
    await viewer.waitFor((m) => m.type === "agentUpdated" && (m.agent as Message).connected === false, "agente desconectado");
  });

  it("token revogado antes do hello não registra o agente", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    server.accounts.tokens.revoke(ana.user.id, ana.token.id);
    bridge.send(hello(randomUUID()));
    expect(await bridge.closed).toBe(4001);
  });

  it("desativar a conta derruba ponte e navegador na varredura", async () => {
    const server = await live({ sweepMs: 50 });
    const ana = await person(server, "ana");
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(randomUUID()));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor((m) => m.type === "welcome", "welcome");
    disableUser(server.accounts, ana.user.id);
    expect(await bridge.closed).toBe(4001);
    expect(await viewer.closed).toBe(4001);
  });

  it("quando a ponte cai, quem assiste é avisado e o agente some depois do prazo", async () => {
    const server = await live({ graceMs: 50 });
    const ana = await person(server, "ana");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor(knowsAgent(agentId), "agente na lista");
    viewer.send({ type: "watch", agentId });
    await bridge.waitFor((m) => m.type === "viewers", "viewers");
    bridge.ws.close();
    await viewer.waitFor((m) => m.type === "agentUpdated" && (m.agent as Message).connected === false, "reconectando");
    await viewer.waitFor((m) => m.type === "watchEnded" && m.reason === "agent-gone", "watchEnded");
    await viewer.waitFor((m) => m.type === "agentRemoved" && m.agentId === agentId, "agentRemoved");
  });
});
