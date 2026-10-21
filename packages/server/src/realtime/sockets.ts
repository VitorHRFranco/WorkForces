import type { IncomingMessage } from "node:http";
import {
  AgentToServer,
  CLOSE_CODES,
  ClientToServer,
  LIMITS,
  PROTOCOL_VERSION,
  parseJson,
  type ServerToClient,
} from "@workforces/protocol";
import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import type { AccountServices } from "../accounts/index.js";
import type { AppContext } from "../context.js";
import { SESSION_COOKIE, bearerToken, readCookie } from "../http/cookies.js";
import { toMe } from "../http/routes.js";
import type { BridgeLink, ClientLink, Hub } from "./hub.js";
import { MessageRate } from "./rate.js";
import type { Person, World } from "./world.js";

export interface SocketDeps {
  ctx: AppContext;
  accounts: AccountServices;
  hub: Hub;
  world: World;
}

export interface SocketOptions {
  sweepMs?: number;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
}

const HEARTBEAT_MS = 30_000;
const BRIDGE_MAX_PAYLOAD = LIMITS.maxFrameBytes + 16 * 1024;
const CLIENT_MAX_PAYLOAD = 16 * 1024;
const BRIDGE_MESSAGES_PER_SECOND = 100;
const CLIENT_MESSAGES_PER_SECOND = 50;
const MOVES_PER_SECOND = 20;
const WATCHES_PER_SECOND = 20;
const CHATS_PER_SECOND = 5;
const CONNECTIONS_PER_MINUTE = 20;

interface BridgeConnection {
  ws: WebSocket;
  tokenId: number;
}

interface ClientConnection {
  ws: WebSocket;
  sessionId: string;
}

export function registerSockets(app: FastifyInstance, deps: SocketDeps, options: SocketOptions = {}): void {
  const { ctx, accounts, hub, world } = deps;
  const origin = ctx.config.publicUrl.origin;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const bridgeServer = new WebSocketServer({ noServer: true, maxPayload: BRIDGE_MAX_PAYLOAD });
  const clientServer = new WebSocketServer({ noServer: true, maxPayload: CLIENT_MAX_PAYLOAD });
  const bridges = new Set<BridgeConnection>();
  /** Conexão que não responde ao ping (notebook dormindo, rede trocada) cai: sem isso, avatar fantasma e "dono fora" errado. */
  const alive = new WeakMap<WebSocket, boolean>();
  const trackAlive = (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    // Mensagem também prova que a conexão vive: com o envio congestionado (ponte com upload fraco), o pong chega depois dos quadros.
    ws.on("message", () => alive.set(ws, true));
  };
  const clients = new Map<number, ClientConnection>();
  /** Cotas por pessoa (não por conexão): reconectar não zera nada. */
  const ratesByUser = new Map<number, { total: MessageRate; move: MessageRate; watch: MessageRate; chat: MessageRate; connect: MessageRate }>();
  const ratesFor = (userId: number) => {
    let rates = ratesByUser.get(userId);
    if (!rates) {
      rates = {
        total: new MessageRate(CLIENT_MESSAGES_PER_SECOND, 1000, ctx.now),
        move: new MessageRate(MOVES_PER_SECOND, 1000, ctx.now),
        watch: new MessageRate(WATCHES_PER_SECOND, 1000, ctx.now),
        chat: new MessageRate(CHATS_PER_SECOND, 1000, ctx.now),
        connect: new MessageRate(CONNECTIONS_PER_MINUTE, 60_000, ctx.now),
      };
      ratesByUser.set(userId, rates);
    }
    return rates;
  };

  app.server.on("upgrade", (request: IncomingMessage, socket, head) => {
    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      // Alvo malformado que o parser HTTP aceita: sem isto, o processo cairia.
      return socket.destroy();
    }
    try {
      if (path === "/ws/bridge") bridgeServer.handleUpgrade(request, socket, head, (ws) => onBridge(ws, request));
      else if (path === "/ws/client") clientServer.handleUpgrade(request, socket, head, (ws) => onClient(ws, request));
      else socket.destroy();
    } catch (error) {
      // Erro do servidor ao abrir a conexão (banco fora do ar, por exemplo): registra e derruba só esta conexão.
      ctx.log(`erro ao abrir a conexão ${path}: ${(error as Error).message}`);
      socket.destroy();
    }
  });

  /** Garante a mesa da pessoa (primeiro acesso pelo navegador ou pela ponte) e avisa quem está online. */
  function ensureDesk(person: Person): string | null {
    try {
      const { deskId } = accounts.desks.ensure(person.id, world.map.desks.map((desk) => desk.id));
      for (const desk of world.setDesk(person, deskId)) hub.broadcast({ type: "deskUpdated", desk });
      return deskId;
    } catch (error) {
      // Nunca derruba a conexão: a pessoa segue com a mesa que o servidor já conhecia (ou sem mesa).
      ctx.log(`não consegui gravar a mesa: ${(error as Error).message}`);
      return world.deskIdOf(person.id);
    }
  }

  function onBridge(ws: WebSocket, request: IncomingMessage): void {
    ws.on("error", () => {});
    trackAlive(ws);
    const auth = accounts.tokens.verify(bearerToken(request.headers.authorization));
    // Fecha depois do upgrade: a ponte entende 4001 como fatal e para de tentar.
    if (!auth) return ws.close(CLOSE_CODES.unauthorized, "token inválido");
    accounts.tokens.touch(auth.tokenId);
    const connection: BridgeConnection = { ws, tokenId: auth.tokenId };
    bridges.add(connection);
    const link: BridgeLink = {
      tokenId: auth.tokenId,
      sendViewers: (n) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "viewers", n }));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    const rate = new MessageRate(BRIDGE_MESSAGES_PER_SECOND, 1000, ctx.now);
    let agentId: string | null = null;
    const helloTimer = setTimeout(() => {
      if (agentId === null) ws.close(CLOSE_CODES.invalidMessage, "hello não recebido");
    }, helloTimeoutMs);

    ws.on("message", (data, isBinary) => {
      if (ws.readyState !== ws.OPEN) return;
      if (!rate.allow()) return ws.close(CLOSE_CODES.rateLimited, "mensagens demais");
      const message = isBinary ? null : parseJson(AgentToServer, data.toString());
      if (!message) return ws.close(CLOSE_CODES.invalidMessage, "mensagem inválida");
      if (agentId === null) {
        if (message.type !== "hello") return ws.close(CLOSE_CODES.invalidMessage, "esperava hello");
        if (message.protocol !== PROTOCOL_VERSION) return ws.close(CLOSE_CODES.protocolMismatch, "versão do protocolo incompatível");
        // Token revogado entre o upgrade e o hello: o hub ainda não conhece esta ponte.
        if (!accounts.tokens.isValid(auth.tokenId)) return ws.close(CLOSE_CODES.unauthorized, "token revogado");
        ensureDesk(auth.user);
        const result = hub.registerAgent({ id: auth.user.id, name: auth.user.name }, message, link);
        if (!result.ok) return ws.close(CLOSE_CODES.invalidMessage, "agentId em uso");
        agentId = message.agentId;
        clearTimeout(helloTimer);
        return;
      }
      if (message.type === "frame") hub.agentFrame(link, agentId, message);
      else if (message.type === "status") hub.agentStatus(link, agentId, message.state);
      else ws.close(CLOSE_CODES.invalidMessage, "hello repetido");
    });

    ws.on("close", (code) => {
      clearTimeout(helloTimer);
      bridges.delete(connection);
      if (agentId === null) return;
      // 1000: a ponte fechou de propósito (o claude terminou); queda de rede chega como 1006.
      if (code === 1000) hub.agentEnded(link, agentId);
      else hub.agentDisconnected(link, agentId);
    });
  }

  function onClient(ws: WebSocket, request: IncomingMessage): void {
    ws.on("error", () => {});
    trackAlive(ws);
    if (request.headers.origin !== origin) return ws.close(CLOSE_CODES.originNotAllowed, "origem não permitida");
    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE);
    const user = accounts.sessions.lookup(sessionId);
    if (!user || !sessionId) return ws.close(CLOSE_CODES.unauthorized, "faça login");

    const rates = ratesFor(user.id);
    if (!rates.connect.allow()) return ws.close(CLOSE_CODES.rateLimited, "conexões demais");

    clients.get(user.id)?.ws.close(CLOSE_CODES.replacedByNewTab, "aberto em outra aba");
    const connection: ClientConnection = { ws, sessionId };
    clients.set(user.id, connection);
    const deskId = ensureDesk(user);
    const firstTab = !world.isOnline(user.id);
    const player = world.join(user);
    const link: ClientLink = {
      userId: user.id,
      send: (message: ServerToClient) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      bufferedAmount: () => ws.bufferedAmount,
      close: (code, reason) => ws.close(code, reason),
    };
    link.send({
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      me: { ...toMe(user), deskId },
      players: world.online(),
      agents: hub.addClient(link),
      desks: world.desks(),
      chat: world.chat(),
    });
    if (firstTab) hub.broadcast({ type: "playerJoined", player }, link);
    const { total: rate, move: moveRate, watch: watchRate, chat: chatRate } = rates;

    ws.on("message", (data, isBinary) => {
      if (ws.readyState !== ws.OPEN) return;
      if (!rate.allow()) return ws.close(CLOSE_CODES.rateLimited, "mensagens demais");
      const message = isBinary ? null : parseJson(ClientToServer, data.toString());
      if (!message) return ws.close(CLOSE_CODES.invalidMessage, "mensagem inválida");
      if (message.type === "move") {
        if (!moveRate.allow()) return ws.close(CLOSE_CODES.rateLimited, "movimento demais");
        const moved = world.move(user.id, message.x, message.y, message.dir, message.moving);
        if (moved) hub.broadcast({ type: "playerMoved", playerId: moved.id, x: moved.x, y: moved.y, dir: moved.dir, moving: moved.moving }, link);
        hub.recheckWatch(link);
        return;
      }
      if (message.type === "chat") {
        if (!chatRate.allow()) return ws.close(CLOSE_CODES.rateLimited, "mensagens de chat demais");
        hub.broadcast({ type: "chat", ...world.addChat(user, message.text, ctx.now()) });
        return;
      }
      if (!watchRate.allow()) return ws.close(CLOSE_CODES.rateLimited, "mensagens demais");
      if (message.type === "unwatch") return hub.unwatch(link);
      const result = hub.watch(link, message.agentId);
      if (result !== "ok") link.send({ type: "watchEnded", agentId: message.agentId, reason: result === "gone" ? "agent-gone" : "left-zone" });
    });

    ws.on("close", () => {
      hub.removeClient(link);
      if (clients.get(user.id) !== connection) return; // trocado por outra aba: a pessoa continua no mapa
      clients.delete(user.id);
      world.leave(user.id);
      hub.broadcast({ type: "playerLeft", playerId: user.id });
    });
  }

  const sweep = setInterval(() => {
    for (const bridge of bridges) {
      if (!accounts.tokens.isValid(bridge.tokenId)) {
        hub.closeBridgesForToken(bridge.tokenId);
        bridge.ws.close(CLOSE_CODES.unauthorized, "token revogado");
      }
    }
    for (const client of clients.values()) {
      // Só confere: renovar aqui manteria viva para sempre a sessão de uma aba esquecida aberta.
      if (!accounts.sessions.lookup(client.sessionId, { renew: false })) client.ws.close(CLOSE_CODES.unauthorized, "sessão encerrada");
    }
    // Conta desativada por outro processo (CLI): a mesa fica livre na tela também (spec 6.5).
    for (const desk of world.desks()) {
      if (desk.ownerId === null || accounts.users.isActive(desk.ownerId)) continue;
      for (const changed of world.setDesk({ id: desk.ownerId, name: desk.ownerName ?? "" }, null)) hub.broadcast({ type: "deskUpdated", desk: changed });
    }
  }, options.sweepMs ?? 30_000);
  sweep.unref();

  const heartbeat = setInterval(() => {
    for (const ws of [...bridgeServer.clients, ...clientServer.clients]) {
      if (ws.readyState !== ws.OPEN) continue;
      if (alive.get(ws) === false) {
        ws.terminate(); // 1006: o navegador sai do mapa; a ponte fica "reconectando" e some depois do prazo
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();

  app.addHook("preClose", async () => {
    clearInterval(sweep);
    clearInterval(heartbeat);
    for (const ws of [...bridgeServer.clients, ...clientServer.clients]) ws.terminate();
    bridgeServer.close();
    clientServer.close();
  });
}
