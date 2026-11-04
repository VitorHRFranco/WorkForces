import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
    expect(config.mapFile.replace(/\\/g, "/")).toMatch(/assets\/map\/office\.tmj$/);
    expect(existsSync(config.mapFile)).toBe(true);
  });

  it("lê as variáveis WF_*", () => {
    const config = loadServerConfig({
      WF_PORT: "8080",
      WF_HOST: "0.0.0.0",
      WF_PUBLIC_URL: "https://workforces.exemplo",
      WF_DATA_DIR: "/dados",
      WF_TRUST_PROXY: "1",
    });
    expect(config).toMatchObject({ port: 8080, host: "0.0.0.0", dataDir: "/dados", trustProxy: true });
    expect(config.publicUrl.origin).toBe("https://workforces.exemplo");
    expect(loadServerConfig({ WF_MAP: "mapas/outro.tmj" }).mapFile).toBe(resolve("mapas/outro.tmj"));
  });

  it("liga o HTTPS próprio e o pino por arquivo", () => {
    expect(loadServerConfig({}).tls).toBe("off");
    expect(loadServerConfig({}).pinFile).toBeNull();
    expect(loadServerConfig({ WF_TLS: "self-signed", WF_PUBLIC_URL: "https://192.168.0.10:4600" }).tls).toBe("self-signed");
    expect(loadServerConfig({ WF_TLS_PIN_FILE: "ca/root.crt", WF_PUBLIC_URL: "https://escritorio.interno" }).pinFile).toBe(resolve("ca/root.crt"));
  });

  it("recusa combinações de TLS que não fazem sentido", () => {
    expect(() => loadServerConfig({ WF_TLS: "sim" })).toThrow("WF_TLS inválida: sim (use self-signed)");
    expect(() => loadServerConfig({ WF_TLS: "self-signed" })).toThrow("WF_TLS=self-signed pede WF_PUBLIC_URL com https");
    expect(() => loadServerConfig({ WF_TLS_PIN_FILE: "x.crt" })).toThrow("WF_TLS_PIN_FILE pede WF_PUBLIC_URL com https");
    expect(() =>
      loadServerConfig({ WF_TLS: "self-signed", WF_TLS_PIN_FILE: "x.crt", WF_PUBLIC_URL: "https://a.b" }),
    ).toThrow("use WF_TLS=self-signed ou WF_TLS_PIN_FILE, não os dois");
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
