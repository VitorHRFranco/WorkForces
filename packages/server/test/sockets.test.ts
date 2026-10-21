import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { disableUser } from "../src/accounts/index.js";
import { TestSocket, bridgeSocket, clientSocket, hello, startLiveServer, type LiveServer, type Message } from "./helpers/live.js";
import { JSON_HEADERS, ORIGIN, createUser } from "./helpers/setup.js";
import { sleep } from "./helpers/wait.js";

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

/** Leva quem assiste para o meio da mesa do dono e pede para assistir (o `move` chega antes do `watch`). */
function watchFromDesk(server: LiveServer, viewer: TestSocket, ownerId: number, agentId: string): void {
  const deskId = server.world.deskIdOf(ownerId);
  const desk = server.world.map.desks.find((candidate) => candidate.id === deskId);
  if (!desk) throw new Error("o dono não tem mesa");
  viewer.send({ type: "move", x: desk.zone.x + desk.zone.width / 2, y: desk.zone.y + desk.zone.height / 2, dir: "up", moving: false });
  viewer.send({ type: "watch", agentId });
}

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
  it("o navegador recebe a mesa dele e as mesas do escritório; mesa nova é avisada a todos", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const tab = clientSocket(server, ana.session);
    const welcome = await tab.waitFor((m) => m.type === "welcome", "welcome");
    expect(welcome.me).toMatchObject({ name: "ana", deskId: "mesa-1" });
    expect((welcome.desks as Message[])[0]).toEqual({ id: "mesa-1", ownerId: ana.user.id, ownerName: "ana" });
    expect((welcome.desks as Message[])).toHaveLength(8);
    // A ponte de quem nunca abriu o escritório também recebe mesa (no hello).
    const bia = await person(server, "bia");
    const bridge = bridgeSocket(server, bia.token.token);
    await bridge.opened();
    bridge.send(hello(randomUUID()));
    await tab.waitFor((m) => m.type === "deskUpdated" && (m.desk as Message).id === "mesa-2" && (m.desk as Message).ownerName === "bia", "mesa da bia");
  });

  it("sem mesa livre a pessoa entra sem mesa", async () => {
    const server = await live();
    for (let i = 1; i <= 8; i++) {
      const user = await createUser(server.accounts, `pessoa${i}`);
      server.accounts.desks.ensure(user.id, server.world.map.desks.map((desk) => desk.id));
    }
    const caio = await person(server, "caio");
    const welcome = await clientSocket(server, caio.session).waitFor((m) => m.type === "welcome", "welcome");
    expect(welcome.me).toMatchObject({ name: "caio", deskId: null });
  });
  it("falha ao gravar a mesa não derruba a ponte nem o navegador", async () => {
    const server = await live();
    server.accounts.desks.ensure = () => {
      throw new Error("database is locked");
    };
    const ana = await person(server, "ana");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const tab = clientSocket(server, ana.session);
    const welcome = await tab.waitFor(knowsAgent(agentId), "agente registrado");
    expect(welcome.type === "welcome" ? welcome.me : null).toMatchObject({ name: "ana", deskId: null });
    expect(server.logs.some((line) => line.includes("não consegui gravar a mesa"))).toBe(true);
  });

  it("erro do servidor ao abrir a conexão vai para o log e derruba só aquela conexão", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    server.accounts.sessions.lookup = () => {
      throw new Error("banco fora do ar");
    };
    const tab = clientSocket(server, ana.session);
    expect(await tab.closed).toBe(1006);
    expect(server.logs).toContain("erro ao abrir a conexão /ws/client: banco fora do ar");
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
    watchFromDesk(server, viewer, ana.user.id, agentId);
    await bridge.waitFor((m) => m.type === "viewers" && m.n === 1, "viewers 1");
    bridge.send(keyFrame(1, "OLÁ"));
    const received = await viewer.waitFor((m) => m.type === "frame" && m.seq === 1, "quadro 1");
    expect(received).toMatchObject({ agentId, key: true, lines: [[0, "OLÁ"], [1, ""]] });

    const late = clientSocket(server, ana.session);
    await late.waitFor((m) => m.type === "welcome", "welcome");
    watchFromDesk(server, late, ana.user.id, agentId);
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

  it("conexão que não responde ao ping sai do mapa", async () => {
    const server = await live({ heartbeatMs: 300 });
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const watcher = clientSocket(server, bia.session);
    await watcher.waitFor((m) => m.type === "welcome", "welcome");
    const ghost = new TestSocket(`${server.wsBase}/ws/client`, { headers: { cookie: `wf_session=${ana.session}` }, origin: ORIGIN, autoPong: false });
    await watcher.waitFor((m) => m.type === "playerJoined", "ana entrou");
    await watcher.waitFor((m) => m.type === "playerLeft" && m.playerId === ana.user.id, "ana saiu");
    expect(await ghost.closed).toBe(1006);
  });

  it("conexão que manda mensagens continua viva mesmo sem responder ao ping, e cai quando para", async () => {
    const server = await live({ heartbeatMs: 300 });
    const ana = await person(server, "ana");
    const busy = new TestSocket(`${server.wsBase}/ws/client`, { headers: { cookie: `wf_session=${ana.session}` }, origin: ORIGIN, autoPong: false });
    await busy.waitFor((m) => m.type === "welcome", "welcome");
    const { spawn } = server.world.map;
    for (let i = 0; i < 15; i++) {
      busy.send({ type: "move", x: spawn.x + (i % 2), y: spawn.y, dir: "right", moving: true });
      await sleep(100);
    }
    expect(busy.ws.readyState).toBe(busy.ws.OPEN); // 1,5 s = 5 rodadas de ping sem pong
    expect(await busy.closed).toBe(1006);
  });

  it("desativar a conta derruba ponte e navegador na varredura", async () => {
    const server = await live({ sweepMs: 50 });
    const ana = await person(server, "ana");
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(randomUUID()));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor((m) => m.type === "welcome", "welcome");
    const bia = await person(server, "bia");
    const other = clientSocket(server, bia.session);
    await other.waitFor((m) => m.type === "welcome", "welcome da bia");
    disableUser(server.accounts, ana.user.id);
    await other.waitFor((m) => m.type === "deskUpdated" && (m.desk as Message).id === "mesa-1" && (m.desk as Message).ownerId === null, "mesa-1 livre");
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
    watchFromDesk(server, viewer, ana.user.id, agentId);
    await bridge.waitFor((m) => m.type === "viewers", "viewers");
    bridge.ws.close();
    await viewer.waitFor((m) => m.type === "agentUpdated" && (m.agent as Message).connected === false, "reconectando");
    await viewer.waitFor((m) => m.type === "watchEnded" && m.reason === "agent-gone", "watchEnded");
    await viewer.waitFor((m) => m.type === "agentRemoved" && m.agentId === agentId, "agentRemoved");
  });

  it("quando o claude termina (fechamento 1000), o agente some na hora", async () => {
    const server = await live({ graceMs: 60_000 });
    const ana = await person(server, "ana");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const viewer = clientSocket(server, ana.session);
    await viewer.waitFor(knowsAgent(agentId), "agente na lista");
    watchFromDesk(server, viewer, ana.user.id, agentId);
    await bridge.waitFor((m) => m.type === "viewers", "viewers");
    bridge.ws.close(1000);
    await viewer.waitFor((m) => m.type === "watchEnded" && m.reason === "agent-gone", "watchEnded");
    await viewer.waitFor((m) => m.type === "agentRemoved" && m.agentId === agentId, "agentRemoved");
  });

  it("assistir exige estar perto da mesa do dono; sair de perto encerra a visita", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const viewer = clientSocket(server, bia.session);
    await viewer.waitFor(knowsAgent(agentId), "agente na lista");

    viewer.send({ type: "watch", agentId }); // bia ainda está na entrada, longe da mesa
    await viewer.waitFor((m) => m.type === "watchEnded" && m.reason === "left-zone", "recusado de longe");
    expect(bridge.messages.some((m) => m.type === "viewers")).toBe(false);

    watchFromDesk(server, viewer, ana.user.id, agentId);
    await bridge.waitFor((m) => m.type === "viewers" && m.n === 1, "viewers 1");
    viewer.send({ type: "move", x: server.world.map.spawn.x, y: server.world.map.spawn.y, dir: "down", moving: true });
    await bridge.waitFor((m) => m.type === "viewers" && m.n === 0, "viewers 0");
    await viewer.waitFor(() => viewer.messages.filter((m) => m.type === "watchEnded" && m.reason === "left-zone").length === 2, "saiu de perto");
  });

  it("agente de quem não tem mesa não pode ser assistido", async () => {
    const server = await live();
    const ids = server.world.map.desks.map((desk) => desk.id);
    const bia = await person(server, "bia");
    server.accounts.desks.ensure(bia.user.id, ids);
    for (let i = 1; i <= 7; i++) server.accounts.desks.ensure((await createUser(server.accounts, `pessoa${i}`)).id, ids);
    const caio = await person(server, "caio");
    const agentId = randomUUID();
    const bridge = bridgeSocket(server, caio.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    const viewer = clientSocket(server, bia.session);
    await viewer.waitFor(knowsAgent(agentId), "agente do caio");
    expect(server.world.deskIdOf(caio.user.id)).toBeNull();
    const desk = server.world.map.desks[0]!;
    viewer.send({ type: "move", x: desk.zone.x + 8, y: desk.zone.y + 8, dir: "up", moving: false });
    viewer.send({ type: "watch", agentId });
    await viewer.waitFor((m) => m.type === "watchEnded" && m.reason === "left-zone", "recusado");
    expect(bridge.messages.some((m) => m.type === "viewers")).toBe(false);
  });
});

describe("presença e movimento", () => {
  it("quem entra e quem anda aparece para os outros, dentro dos limites do mapa", async () => {
    const server = await live();
    const { spawn, widthPx } = server.world.map;
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const anaTab = clientSocket(server, ana.session);
    const anaWelcome = await anaTab.waitFor((m) => m.type === "welcome", "welcome da ana");
    expect(anaWelcome.players).toEqual([{ id: ana.user.id, name: "ana", x: spawn.x, y: spawn.y, dir: "down", moving: false }]);
    const biaTab = clientSocket(server, bia.session);
    const biaWelcome = await biaTab.waitFor((m) => m.type === "welcome", "welcome da bia");
    expect((biaWelcome.players as Message[]).map((p) => p.name).sort()).toEqual(["ana", "bia"]);
    await anaTab.waitFor((m) => m.type === "playerJoined" && (m.player as Message).name === "bia", "bia entrou");

    biaTab.send({ type: "move", x: 99_999, y: -5, dir: "right", moving: true });
    const moved = await anaTab.waitFor((m) => m.type === "playerMoved", "bia andou");
    expect(moved).toEqual({ type: "playerMoved", playerId: bia.user.id, x: widthPx, y: 0, dir: "right", moving: true });
    expect(biaTab.messages.some((m) => m.type === "playerMoved")).toBe(false);

    biaTab.ws.close();
    await anaTab.waitFor((m) => m.type === "playerLeft" && m.playerId === bia.user.id, "bia saiu");
    const again = clientSocket(server, bia.session);
    const back = await again.waitFor((m) => m.type === "welcome", "bia voltou");
    expect((back.players as Message[]).find((p) => p.id === bia.user.id)).toMatchObject({ x: widthPx, y: 0, moving: false });
  });

  it("segunda aba não faz a pessoa sair nem entrar de novo", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const watcher = clientSocket(server, bia.session);
    await watcher.waitFor((m) => m.type === "welcome", "welcome");
    const first = clientSocket(server, ana.session);
    await watcher.waitFor((m) => m.type === "playerJoined", "ana entrou");
    const second = clientSocket(server, ana.session);
    expect(await first.closed).toBe(4009);
    await second.waitFor((m) => m.type === "welcome", "segunda aba");
    await sleep(100);
    expect(watcher.messages.filter((m) => m.type === "playerJoined")).toHaveLength(1);
    expect(watcher.messages.some((m) => m.type === "playerLeft")).toBe(false);
  });

  it("agente aparece como dono fora até o dono abrir o escritório", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const agentId = randomUUID();
    const watcher = clientSocket(server, bia.session);
    await watcher.waitFor((m) => m.type === "welcome", "welcome");
    const bridge = bridgeSocket(server, ana.token.token);
    await bridge.opened();
    bridge.send(hello(agentId));
    await watcher.waitFor((m) => m.type === "agentAdded" && (m.agent as Message).ownerAway === true, "dono fora");
    const anaTab = clientSocket(server, ana.session);
    await watcher.waitFor((m) => m.type === "agentUpdated" && (m.agent as Message).ownerAway === false, "dono chegou");
    anaTab.ws.close();
    await watcher.waitFor(
      () => watcher.messages.filter((m) => m.type === "agentUpdated" && (m.agent as Message).ownerAway === true).length === 1,
      "dono saiu",
    );
  });

  it("movimento demais fecha com 4008", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const tab = clientSocket(server, ana.session);
    await tab.waitFor((m) => m.type === "welcome", "welcome");
    for (let i = 0; i < 25; i++) tab.send({ type: "move", x: i, y: 10, dir: "right", moving: true });
    expect(await tab.closed).toBe(4008);
  });
});

describe("chat", () => {
  it("a mensagem vai para todos, com o nome de quem mandou, e quem chega depois recebe o histórico", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const anaTab = clientSocket(server, ana.session);
    await anaTab.waitFor((m) => m.type === "welcome", "welcome da ana");
    const biaTab = clientSocket(server, bia.session);
    await biaTab.waitFor((m) => m.type === "welcome", "welcome da bia");
    biaTab.send({ type: "chat", text: "bom dia!" });
    const received = await anaTab.waitFor((m) => m.type === "chat", "chat na ana");
    expect(received).toMatchObject({ type: "chat", id: 1, fromId: bia.user.id, name: "bia", text: "bom dia!" });
    await biaTab.waitFor((m) => m.type === "chat", "chat de volta na bia");
    expect(server.logs.join("\n")).not.toContain("bom dia");
    anaTab.ws.close();
    const later = clientSocket(server, ana.session);
    const welcome = await later.waitFor((m) => m.type === "welcome", "welcome de novo");
    expect(welcome.chat).toEqual([expect.objectContaining({ id: 1, name: "bia", text: "bom dia!" })]);
  });

  it("chat inválido fecha com 4000 e chat demais com 4008", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const first = clientSocket(server, ana.session);
    await first.waitFor((m) => m.type === "welcome", "welcome");
    first.send({ type: "chat", text: " oi" });
    expect(await first.closed).toBe(4000);
    const second = clientSocket(server, ana.session);
    await second.waitFor((m) => m.type === "welcome", "welcome");
    for (let i = 0; i < 6; i++) second.send({ type: "chat", text: `oi ${i}` });
    expect(await second.closed).toBe(4008);
  });
});

describe("chat: limites por pessoa e remetente", () => {
  it("a cota de chat não zera ao reconectar", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const first = clientSocket(server, ana.session);
    await first.waitFor((m) => m.type === "welcome", "welcome");
    for (let i = 0; i < 4; i++) first.send({ type: "chat", text: `oi ${i}` });
    const second = clientSocket(server, ana.session);
    await second.waitFor((m) => m.type === "welcome", "welcome da segunda aba");
    expect(await first.closed).toBe(4009);
    second.send({ type: "chat", text: "mais um" });
    second.send({ type: "chat", text: "e outro" });
    expect(await second.closed).toBe(4008);
  });

  it("reconectar em laço fecha com 4008", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const tab = clientSocket(server, ana.session);
      const outcome = await Promise.race([tab.waitFor((m) => m.type === "welcome", `welcome ${i}`).then(() => 0), tab.closed]);
      last = outcome;
    }
    expect(last).toBe(4008);
  });

  it("o remetente vem da sessão, não da mensagem", async () => {
    const server = await live();
    const ana = await person(server, "ana");
    const bia = await person(server, "bia");
    const anaTab = clientSocket(server, ana.session);
    await anaTab.waitFor((m) => m.type === "welcome", "welcome da ana");
    const biaTab = clientSocket(server, bia.session);
    await biaTab.waitFor((m) => m.type === "welcome", "welcome da bia");
    biaTab.send({ type: "chat", text: "oi", fromId: ana.user.id, name: "ana" });
    const received = await anaTab.waitFor((m) => m.type === "chat", "chat na ana");
    expect(received).toMatchObject({ fromId: bia.user.id, name: "bia", text: "oi" });
  });
});
