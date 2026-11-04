import { CreateTokenRequest, Credentials, LoginRequest, inviteAppLink, type Me, type TlsAnchor } from "@workforces/protocol";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountServices } from "../accounts/index.js";
import { INVITE_TTL_MS } from "../accounts/invites.js";
import { nameKeyOf, type User } from "../accounts/users.js";
import type { AppContext } from "../context.js";
import { bearerToken, clearedSessionCookie, originAllowed, sessionCookie, sessionIdOf } from "./cookies.js";
import { AttemptLimiter } from "./limiter.js";

export interface ApiDeps {
  ctx: AppContext;
  accounts: AccountServices;
  /** Chamado depois de revogar um token, para derrubar as conexões vivas dele. */
  onTokenRevoked(tokenId: number): void;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PIN_UNAVAILABLE = "o certificado da rede interna ainda não está disponível; tente de novo em instantes";

export function toMe(user: User): Me {
  return { id: user.id, name: user.name, isAdmin: user.isAdmin };
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx, accounts } = deps;
  const origin = ctx.config.publicUrl.origin;
  const secure = ctx.config.publicUrl.protocol === "https:";
  const byIp = new AttemptLimiter(30, LOGIN_WINDOW_MS, ctx.now);
  const byName = new AttemptLimiter(10, LOGIN_WINDOW_MS, ctx.now);
  const currentUser = (request: FastifyRequest) => accounts.sessions.lookup(sessionIdOf(request.headers));

  // Contra requisição forjada: origem exata quando o pedido diz de onde vem ou leva cookie (`originAllowed`), e JSON sempre
  // (application/json força a pré-checagem do navegador, que este servidor não aprova).
  app.addHook("onRequest", async (request, reply) => {
    if (!STATE_CHANGING.has(request.method)) return;
    if (!originAllowed(request.headers, origin)) return reply.code(403).send({ error: `origem não permitida; abra o escritório em ${origin}` });
    if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
      return reply.code(415).send({ error: "use application/json" });
    }
  });

  app.post("/api/login", async (request, reply) => {
    const body = LoginRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "nome e senha são obrigatórios" });
    const ipKey = request.ip;
    const nameKey = nameKeyOf(body.data.name);
    // Registra antes do scrypt: uma rajada simultânea não passa toda pelo limite.
    if (!byIp.tryAcquire(ipKey)) return reply.code(429).send({ error: "muitas tentativas; espere alguns minutos" });
    if (!byName.tryAcquire(nameKey)) {
      byIp.release(ipKey);
      return reply.code(429).send({ error: "muitas tentativas; espere alguns minutos" });
    }
    const user = await accounts.users.authenticate(body.data.name, body.data.password);
    if (!user) return reply.code(401).send({ error: "nome ou senha inválidos" });
    byIp.release(ipKey);
    byName.reset(nameKey);
    return reply.header("set-cookie", sessionCookie(accounts.sessions.create(user.id), secure)).send(toMe(user));
  });

  app.post("/api/logout", async (request, reply) => {
    const sessionId = sessionIdOf(request.headers);
    if (sessionId) accounts.sessions.delete(sessionId);
    return reply.code(204).header("set-cookie", clearedSessionCookie(secure)).send();
  });

  app.get("/api/me", async (request, reply) => {
    const sessionId = sessionIdOf(request.headers);
    const user = accounts.sessions.lookup(sessionId);
    if (!user || !sessionId) return reply.code(401).send({ error: "faça login" });
    return reply.header("set-cookie", sessionCookie(sessionId, secure)).send(toMe(user));
  });

  app.get<{ Params: { code: string } }>("/api/invites/:code", async (request) => ({ valid: accounts.invites.isValid(request.params.code) }));

  app.post<{ Params: { code: string } }>("/api/invites/:code/accept", async (request, reply) => {
    const body = Credentials.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "nome com 2 a 32 letras, números, ponto, _ ou -; senha com pelo menos 10 caracteres" });
    }
    const result = await accounts.invites.accept(request.params.code, body.data.name, body.data.password);
    if (!result.ok) {
      return result.reason === "name-taken"
        ? reply.code(409).send({ error: "esse nome já está em uso" })
        : reply.code(410).send({ error: "convite inválido ou expirado" });
    }
    return reply.code(201).header("set-cookie", sessionCookie(accounts.sessions.create(result.user.id), secure)).send(toMe(result.user));
  });

  app.post("/api/invites", async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: "faça login" });
    if (!user.isAdmin) return reply.code(403).send({ error: "só admin gera convites" });
    // Confere o pino antes de criar: sem certificado não há link que o app consiga usar, e o convite não deve ser gasto à toa.
    const pin = ctx.pin ? ctx.pin.current() : undefined;
    if (pin === null) return reply.code(503).send({ error: PIN_UNAVAILABLE });
    const invite = accounts.invites.create({ createdBy: user.id, isAdmin: false, ttlMs: INVITE_TTL_MS });
    const url = pin ? inviteAppLink(origin, invite.code, pin.pin) : `${origin}/invite/${invite.code}`;
    return reply.code(201).send({ url, expiresAt: invite.expiresAt });
  });

  // O app busca a âncora aqui (sem sessão) para confiar neste servidor; o pino do convite garante que é o certificado certo.
  app.get("/api/tls/anchor", async (_request, reply) => {
    if (!ctx.pin) return reply.code(404).send({ error: "não encontrado" });
    const current = ctx.pin.current();
    if (!current) return reply.code(503).send({ error: PIN_UNAVAILABLE });
    const body: TlsAnchor = { anchor: current.anchor };
    return reply.header("cache-control", "no-store").send(body);
  });

  app.get("/api/tokens", async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: "faça login" });
    return accounts.tokens.list(user.id);
  });

  app.post("/api/tokens", async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: "faça login" });
    const body = CreateTokenRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "dê um nome de 1 a 40 caracteres ao token" });
    return reply.code(201).send(accounts.tokens.create(user.id, body.data.name));
  });

  app.delete<{ Params: { id: string } }>("/api/tokens/:id", async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: "faça login" });
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || !accounts.tokens.revoke(user.id, id)) return reply.code(404).send({ error: "token não encontrado" });
    deps.onTokenRevoked(id);
    return reply.code(204).send();
  });

  app.get("/api/bridge/whoami", async (request, reply) => {
    const auth = accounts.tokens.verify(bearerToken(request.headers.authorization));
    if (!auth) return reply.code(401).send({ error: "token inválido" });
    accounts.tokens.touch(auth.tokenId);
    return { name: auth.user.name };
  });
}
