import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ServerConfigError, exposureWarning, loadServerConfig } from "../src/config.js";

describe("loadServerConfig", () => {
  it("tem padrões para rodar localmente", () => {
    const config = loadServerConfig({});
    expect(config.port).toBe(4600);
    expect(config.host).toBe("127.0.0.1");
    expect(config.publicUrl.origin).toBe("http://localhost:4600");
    expect(config.insecure).toBe(false);
    expect(config.trustProxy).toBe(false);
    expect(config.dataDir).toMatch(/\.workforces-server$/);
    expect(config.clientDir.replace(/\\/g, "/")).toMatch(/packages\/client\/dist$/);
    expect(config.mapFile.replace(/\\/g, "/")).toMatch(/assets\/map\/office\.tmj$/);
    expect(existsSync(config.mapFile)).toBe(true);
  });

  it("lê as variáveis WF_*", () => {
    const config = loadServerConfig({
      WF_PORT: "8080",
      WF_HOST: "0.0.0.0",
      WF_PUBLIC_URL: "https://workforces.exemplo",
      WF_DATA_DIR: "/dados",
      WF_CLIENT_DIR: "/cliente",
      WF_TRUST_PROXY: "1",
    });
    expect(config).toMatchObject({ port: 8080, host: "0.0.0.0", dataDir: "/dados", clientDir: resolve("/cliente"), trustProxy: true });
    const relative = loadServerConfig({ WF_CLIENT_DIR: "cliente/dist" }).clientDir;
    expect(relative).toBe(resolve("cliente/dist"));
    expect(isAbsolute(relative)).toBe(true);
    expect(config.publicUrl.origin).toBe("https://workforces.exemplo");
    expect(loadServerConfig({ WF_MAP: "mapas/outro.tmj" }).mapFile).toBe(resolve("mapas/outro.tmj"));
  });

  it("recusa HTTP fora de localhost sem WF_INSECURE", () => {
    expect(() => loadServerConfig({ WF_PUBLIC_URL: "http://10.0.0.5:4600" })).toThrow(ServerConfigError);
    expect(loadServerConfig({ WF_PUBLIC_URL: "http://10.0.0.5:4600", WF_INSECURE: "1" }).insecure).toBe(true);
  });

  it("recusa porta e URL inválidas", () => {
    expect(() => loadServerConfig({ WF_PORT: "abc" })).toThrow(ServerConfigError);
    expect(() => loadServerConfig({ WF_PORT: "0" })).toThrow(ServerConfigError);
    expect(loadServerConfig({ WF_PORT: "" }).port).toBe(4600);
    expect(() => loadServerConfig({ WF_PUBLIC_URL: "ftp://x" })).toThrow(ServerConfigError);
    expect(() => loadServerConfig({ WF_PUBLIC_URL: "não é url" })).toThrow(ServerConfigError);
  });
});

describe("exposureWarning", () => {
  it("avisa quem escuta na rede sem HTTPS; localhost e HTTPS ficam quietos", () => {
    expect(exposureWarning(loadServerConfig({}))).toBeNull();
    expect(exposureWarning(loadServerConfig({ WF_HOST: "0.0.0.0", WF_PUBLIC_URL: "https://escritorio.exemplo" }))).toBeNull();
    expect(exposureWarning(loadServerConfig({ WF_HOST: "0.0.0.0" }))).toContain("sem HTTPS");
    expect(exposureWarning(loadServerConfig({ WF_HOST: "192.168.0.10", WF_PUBLIC_URL: "http://192.168.0.10:4600", WF_INSECURE: "1" }))).toContain("192.168.0.10");
  });
});
