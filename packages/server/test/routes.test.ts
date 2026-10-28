import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { JSON_HEADERS, ORIGIN, cookieOf, createUser, sessionOf, setupApi, testConfig } from "./helpers/setup.js";

describe("login e sessão", () => {
  it("login certo devolve o usuário e um cookie protegido", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana", { admin: true });
    const response = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ANA", password: "senha-forte-123" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "ana", isAdmin: true });
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/^wf_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=1209600$/);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieOf(response) } });
    expect(me.json()).toMatchObject({ name: "ana" });
    expect(String(me.headers["set-cookie"])).toBe(`${cookieOf(response)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600`);
  });

  it("uma rajada simultânea respeita o limite", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const wrong = () => app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "errada-errada" } });
    const responses = await Promise.all(Array.from({ length: 20 }, wrong));
    const codes = responses.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(10);
  });

  it("cookie ganha Secure quando o endereço público é https", async () => {
    const { app, accounts } = await setupApi(testConfig({ publicUrl: new URL("https://workforces.exemplo") }));
    await createUser(accounts, "ana");
    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "content-type": "application/json", origin: "https://workforces.exemplo" },
      payload: { name: "ana", password: "senha-forte-123" },
    });
    expect(String(response.headers["set-cookie"])).toMatch(/; Secure$/);
  });

  it("senha errada dá 401 e o excesso de tentativas dá 429", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const wrong = () => app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "errada-errada" } });
    expect((await wrong()).statusCode).toBe(401);
    for (let i = 0; i < 9; i++) await wrong();
    const blocked = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } });
    expect(blocked.statusCode).toBe(429);
  });

  it("logout apaga a sessão", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const login = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } });
    const cookie = cookieOf(login);
    const logout = await app.inject({ method: "POST", url: "/api/logout", headers: { ...JSON_HEADERS, cookie }, payload: {} });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("proteção contra requisição forjada", () => {
  it("com cookie, recusa POST de outra origem ou sem origem; text/plain e formulário dão 415", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const login = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } });
    const cookie = cookieOf(login);
    const payload = JSON.stringify({ name: "ana", password: "senha-forte-123" });
    const foreign = await app.inject({ method: "POST", url: "/api/login", headers: { "content-type": "application/json", origin: "https://malicioso.exemplo", cookie }, payload });
    expect(foreign.statusCode).toBe(403);
    const noOrigin = await app.inject({ method: "POST", url: "/api/login", headers: { "content-type": "application/json", cookie }, payload });
    expect(noOrigin.statusCode).toBe(403);
    const plain = await app.inject({ method: "POST", url: "/api/login", headers: { "content-type": "text/plain", origin: ORIGIN }, payload });
    expect(plain.statusCode).toBe(415);
    const form = await app.inject({ method: "POST", url: "/api/login", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }, payload: "name=ana&password=senha-forte-123" });
    expect(form.statusCode).toBe(415);
    for (const response of [foreign, noOrigin, plain, form]) expect(response.headers["set-cookie"]).toBeUndefined();
  });
});

describe("proteção contra requisição forjada (caminho codificado)", () => {
  it("caminho codificado não escapa da proteção", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana", { admin: true });
    const login = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } });
    const cookie = cookieOf(login);
    const plain = { cookie, "content-type": "text/plain" };
    expect((await app.inject({ method: "POST", url: "/%61pi/logout", headers: plain, payload: "x" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/%61pi/invites", headers: plain, payload: "x" })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/tokens/1", headers: { cookie } })).statusCode).toBe(403);
  });
});

describe("convites", () => {
  it("aceitar convite cria a conta e já entra; o código não vai para o log", async () => {
    const { app, accounts, logs } = await setupApi();
    const { code } = accounts.invites.create({ createdBy: null, isAdmin: true, ttlMs: 60_000 });
    expect((await app.inject({ method: "GET", url: `/api/invites/${code}` })).json()).toEqual({ valid: true });
    const accept = await app.inject({ method: "POST", url: `/api/invites/${code}/accept`, headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } });
    expect(accept.statusCode).toBe(201);
    expect(accept.json()).toMatchObject({ name: "ana", isAdmin: true });
    expect(cookieOf(accept)).toMatch(/^wf_session=/);
    expect((await app.inject({ method: "GET", url: `/api/invites/${code}` })).json()).toEqual({ valid: false });
    const again = await app.inject({ method: "POST", url: `/api/invites/${code}/accept`, headers: JSON_HEADERS, payload: { name: "bia", password: "senha-forte-123" } });
    expect(again.statusCode).toBe(410);
    expect(logs.join("\n")).not.toContain(code);
  });

  it("regras de cadastro e nome repetido", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const { code } = accounts.invites.create({ createdBy: null, isAdmin: false, ttlMs: 60_000 });
    const weak = await app.inject({ method: "POST", url: `/api/invites/${code}/accept`, headers: JSON_HEADERS, payload: { name: "bia", password: "curta" } });
    expect(weak.statusCode).toBe(400);
    const taken = await app.inject({ method: "POST", url: `/api/invites/${code}/accept`, headers: JSON_HEADERS, payload: { name: "Ana", password: "senha-forte-123" } });
    expect(taken.statusCode).toBe(409);
  });

  it("só admin gera convite", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana", { admin: true });
    await createUser(accounts, "bia");
    const login = async (name: string) =>
      cookieOf(await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name, password: "senha-forte-123" } }));
    const asAdmin = await app.inject({ method: "POST", url: "/api/invites", headers: { ...JSON_HEADERS, cookie: await login("ana") }, payload: {} });
    expect(asAdmin.statusCode).toBe(201);
    expect(asAdmin.json().url).toMatch(new RegExp(`^${ORIGIN}/invite/[A-Za-z0-9_-]+$`));
    const asUser = await app.inject({ method: "POST", url: "/api/invites", headers: { ...JSON_HEADERS, cookie: await login("bia") }, payload: {} });
    expect(asUser.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/invites", headers: JSON_HEADERS, payload: {} })).statusCode).toBe(401);
  });
});

describe("tokens da ponte", () => {
  it("cria, lista, valida no whoami e revoga avisando o tempo real", async () => {
    const { app, accounts, revoked, logs } = await setupApi();
    await createUser(accounts, "ana");
    const cookie = cookieOf(await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "ana", password: "senha-forte-123" } }));
    const created = await app.inject({ method: "POST", url: "/api/tokens", headers: { ...JSON_HEADERS, cookie }, payload: { name: "notebook" } });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json() as { id: number; token: string };
    expect(token).toMatch(/^wf_/);
    const list = await app.inject({ method: "GET", url: "/api/tokens", headers: { cookie } });
    expect(list.json()).toEqual([{ id, name: "notebook", createdAt: expect.any(Number), lastUsedAt: null }]);
    const who = await app.inject({ method: "GET", url: "/api/bridge/whoami", headers: { authorization: `Bearer ${token}` } });
    expect(who.json()).toEqual({ name: "ana" });
    const used = await app.inject({ method: "GET", url: "/api/tokens", headers: { cookie } });
    expect((used.json() as { lastUsedAt: number | null }[])[0]?.lastUsedAt).not.toBeNull();
    const del = await app.inject({ method: "DELETE", url: `/api/tokens/${id}`, headers: { ...JSON_HEADERS, cookie }, payload: {} });
    expect(del.statusCode).toBe(204);
    expect(revoked).toEqual([id]);
    expect((await app.inject({ method: "GET", url: "/api/bridge/whoami", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect(logs.join("\n")).not.toContain(token);
  });

  it("não revoga token de outra pessoa", async () => {
    const { app, accounts, revoked } = await setupApi();
    const ana = await createUser(accounts, "ana");
    await createUser(accounts, "bia");
    const anaToken = accounts.tokens.create(ana.id, "notebook");
    const biaCookie = cookieOf(await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: { name: "bia", password: "senha-forte-123" } }));
    const del = await app.inject({ method: "DELETE", url: `/api/tokens/${anaToken.id}`, headers: { ...JSON_HEADERS, cookie: biaCookie }, payload: {} });
    expect(del.statusCode).toBe(404);
    expect(revoked).toEqual([]);
    expect(accounts.tokens.isValid(anaToken.id)).toBe(true);
  });
});

describe("erros da API", () => {
  it("JSON quebrado e corpo grande demais respondem em português, no formato de sempre", async () => {
    const { app } = await setupApi();
    const broken = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: "{" });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toEqual({ error: "pedido inválido" });
    const huge = await app.inject({ method: "POST", url: "/api/login", headers: JSON_HEADERS, payload: JSON.stringify({ name: "x".repeat(70_000), password: "y" }) });
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toEqual({ error: "pedido grande demais" });
  });

  it("erro inesperado vira 500 em português e vai para o log com o padrão da rota, nunca com a URL", async () => {
    const logs: string[] = [];
    const app = buildApp({ config: testConfig(), now: () => 0, log: (message) => logs.push(message) });
    app.get("/api/quebra/:code", async () => {
      throw new Error("o banco caiu");
    });
    const response = await app.inject({ method: "GET", url: "/api/quebra/codigo-secreto-123" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "erro interno do servidor" });
    expect(logs).toEqual(["erro interno em GET /api/quebra/:code: o banco caiu"]);
    await app.close();
  });
});

describe("sessão por Bearer (o app)", () => {
  const APP_JSON = { "content-type": "application/json" };

  it("o app entra sem Origin e sem cookie, e a sessão vale como Bearer na API", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana", { admin: true });
    const login = await app.inject({ method: "POST", url: "/api/login", headers: APP_JSON, payload: { name: "ana", password: "senha-forte-123" } });
    expect(login.statusCode).toBe(200);
    const bearer = { authorization: `Bearer ${sessionOf(login)}` };
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer })).json()).toMatchObject({ name: "ana" });
    expect((await app.inject({ method: "POST", url: "/api/invites", headers: { ...APP_JSON, ...bearer }, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/tokens", headers: { ...APP_JSON, ...bearer }, payload: { name: "app" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/logout", headers: { ...APP_JSON, ...bearer }, payload: {} })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer })).statusCode).toBe(401);
  });

  it("sem cookie, o JSON continua obrigatório", async () => {
    const { app, accounts } = await setupApi();
    await createUser(accounts, "ana");
    const plain = await app.inject({ method: "POST", url: "/api/login", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ name: "ana", password: "senha-forte-123" }) });
    expect(plain.statusCode).toBe(415);
    expect(plain.headers["set-cookie"]).toBeUndefined();
  });

  it("token da ponte não vale como sessão, e sessão não vale como token da ponte", async () => {
    const { app, accounts } = await setupApi();
    const ana = await createUser(accounts, "ana");
    const { token } = accounts.tokens.create(ana.id, "notebook");
    const session = accounts.sessions.create(ana.id);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/bridge/whoami", headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(401);
  });
});
