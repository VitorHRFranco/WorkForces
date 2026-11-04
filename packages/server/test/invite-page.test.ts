import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { ORIGIN, testConfig } from "./helpers/setup.js";

const server = (pin?: { pin: string; anchor: string } | null) =>
  createServer(testConfig(), { dbFile: ":memory:", log: () => {}, ...(pin === undefined ? {} : { pin: { current: () => pin } }) });

describe("página do convite", () => {
  it("abre o app pelo link workforces:// e oferece o instalador, sem gastar o convite", async () => {
    const { app, accounts } = server();
    const { code } = accounts.invites.create({ createdBy: null, isAdmin: false, ttlMs: 60_000 });
    const page = await app.inject({ method: "GET", url: `/invite/${code}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.body).toContain(`href="workforces://invite?server=${encodeURIComponent(ORIGIN)}&amp;code=${code}"`);
    expect(page.body).toContain("https://github.com/VitorHRFranco/WorkForces/releases/latest");
    expect(accounts.invites.isValid(code)).toBe(true);
    await app.close();
  });

  it("com pino, o link da página leva o pino; sem pino, fica como antes", async () => {
    const pin = "B".repeat(43);
    const withPin = server({ pin, anchor: "PEM" });
    const { code } = withPin.accounts.invites.create({ createdBy: null, isAdmin: false, ttlMs: 60_000 });
    const page = await withPin.app.inject({ method: "GET", url: `/invite/${code}` });
    expect(page.body).toContain(`&amp;code=${code}&amp;pin=${pin}"`);
    await withPin.app.close();
    const plain = server();
    const other = plain.accounts.invites.create({ createdBy: null, isAdmin: false, ttlMs: 60_000 });
    expect((await plain.app.inject({ method: "GET", url: `/invite/${other.code}` })).body).not.toContain("pin=");
    await plain.app.close();
  });

  it("código fora do formato dá 404 em JSON e não ecoa nada", async () => {
    const { app } = server();
    for (const url of ["/invite/%3Cscript%3E", `/invite/${"a".repeat(65)}`, "/invite/a/b", "/invite/"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.json()).toEqual({ error: "não encontrado" });
    }
    await app.close();
  });

  it("o servidor não serve mais o site, mas continua com a API e o mapa", async () => {
    const { app } = server();
    for (const url of ["/", "/login", "/office", "/index.html", "/assets/app.js", "/api/nada"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.json()).toEqual({ error: "não encontrado" });
    }
    expect((await app.inject({ method: "GET", url: "/map/map.tmj" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    await app.close();
  });
});
