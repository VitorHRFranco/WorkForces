import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { testConfig } from "./helpers/setup.js";

function clientFixture() {
  const root = mkdtempSync(join(tmpdir(), "wf-static-"));
  writeFileSync(join(root, "segredo.txt"), "SEGREDO-FORA-DO-CLIENTE");
  const dir = join(root, "dist");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html><p>cliente</p>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

describe("registerClient", () => {
  it("serve o cliente e devolve index.html nas rotas do navegador", async () => {
    const { app } = createServer(testConfig({ clientDir: clientFixture() }), { dbFile: ":memory:", log: () => {} });
    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("cliente");
    expect((await app.inject({ method: "GET", url: "/login" })).body).toContain("cliente");
    expect((await app.inject({ method: "GET", url: "/invite/abc" })).body).toContain("cliente");
    expect((await app.inject({ method: "GET", url: "/assets/app.js" })).body).toBe("console.log(1)");
    const missingApi = await app.inject({ method: "GET", url: "/api/nada" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: "não encontrado" });
    for (const url of ["/../segredo.txt", "/%2e%2e/segredo.txt", "/assets/../../segredo.txt"]) {
      expect((await app.inject({ method: "GET", url })).body).not.toContain("SEGREDO");
    }
    await app.close();
  });

  it("sem build do cliente avisa no log e responde 404", async () => {
    const logs: string[] = [];
    const { app } = createServer(testConfig({ clientDir: join(tmpdir(), "wf-sem-cliente") }), { dbFile: ":memory:", log: (m) => logs.push(m) });
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect(logs.join("\n")).toContain("cliente web não encontrado");
    await app.close();
  });
});
