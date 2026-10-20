import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { REPO_MAP, testConfig } from "./helpers/setup.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const quiet = { dbFile: ":memory:", log: () => {} };

describe("mapa do escritório", () => {
  it("serve o mapa e a imagem do tileset, e nada mais da pasta do mapa", async () => {
    const { app } = createServer(testConfig(), quiet);
    const tmj = await app.inject({ method: "GET", url: "/map/map.tmj" });
    expect(tmj.statusCode).toBe(200);
    expect(tmj.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(tmj.body).tilesets[0].image).toBe("office.png");
    const png = await app.inject({ method: "GET", url: "/map/office.png" });
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.rawPayload.subarray(1, 4).toString("latin1")).toBe("PNG");
    for (const url of ["/map/office.tmj", "/map/CREDITS.md", "/map/..%2f..%2fpackage.json", "/map/%2e%2e%2fCREDITS.md", "/map/"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
    }
    await app.close();
  });

  it("um mapa que o escritório não sabe usar impede o servidor de subir, com o motivo", async () => {
    const dir = tempDir("wf-map-");
    const office = JSON.parse(readFileSync(REPO_MAP, "utf8"));
    writeFileSync(join(dir, "externo.tmj"), JSON.stringify({ ...office, tilesets: [{ firstgid: 1, source: "kenney.tsx" }] }));
    writeFileSync(join(dir, "quebrado.tmj"), "{");
    writeFileSync(join(dir, "sem-imagem.tmj"), JSON.stringify(office));
    writeFileSync(join(dir, "bmp.tmj"), JSON.stringify({ ...office, tilesets: [{ ...office.tilesets[0], image: "tiles.bmp" }] }));
    const start = (file: string) => () => createServer(testConfig({ mapFile: join(dir, file) }), quiet);
    expect(start("externo.tmj")).toThrow(/mapa inválido.*tileset externo/);
    expect(start("quebrado.tmj")).toThrow(/não é um JSON válido/);
    expect(start("nao-existe.tmj")).toThrow(/não consegui ler o mapa/);
    expect(start("sem-imagem.tmj")).toThrow(/imagem do tileset não encontrada: office.png/);
    expect(start("bmp.tmj")).toThrow(/png, webp, gif ou jpg/);
    copyFileSync(join(REPO_MAP, "..", "office.png"), join(dir, "office.png"));
    const { app } = start("sem-imagem.tmj")();
    await app.close();
  });

  it("aceita .tmj com BOM no início", async () => {
    const dir = tempDir("wf-map-bom-");
    const office = JSON.parse(readFileSync(REPO_MAP, "utf8"));
    writeFileSync(join(dir, "bom.tmj"), "\uFEFF" + JSON.stringify(office));
    copyFileSync(join(REPO_MAP, "..", "office.png"), join(dir, "office.png"));
    const { app } = createServer(testConfig({ mapFile: join(dir, "bom.tmj") }), quiet);
    await app.close();
  });
});
