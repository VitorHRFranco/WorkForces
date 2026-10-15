import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError, configDir, labelFor, loadConfig } from "../src/config.js";

let dir: string;
const write = (content: string) => writeFileSync(join(dir, "config.json"), content);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-config-"));
});

describe("loadConfig", () => {
  it("sem arquivo devolve os padrões", () => {
    expect(loadConfig(dir)).toEqual({ insecure: false, folders: [], secretPatterns: [] });
  });

  it("aceita arquivo salvo com BOM", () => {
    write("\uFEFF" + JSON.stringify({ server: "https://escritorio.exemplo", token: "wf_teste" }));
    expect(loadConfig(dir)).toMatchObject({ server: "https://escritorio.exemplo", token: "wf_teste" });
  });

  it("recusa JSON quebrado", () => {
    write("{");
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("recusa apelido inválido ou repetido", () => {
    write(JSON.stringify({ folders: [{ alias: "Loja!", path: "C:\\proj" }] }));
    expect(() => loadConfig(dir)).toThrow(ConfigError);
    write(JSON.stringify({ folders: [{ alias: "loja", path: "a" }, { alias: "loja", path: "b" }] }));
    expect(() => loadConfig(dir)).toThrow(/apelido repetido/);
  });
});

describe("configDir", () => {
  it("usa WORKFORCES_HOME quando definido", () => {
    expect(configDir({ WORKFORCES_HOME: dir })).toBe(dir);
  });
});

describe("labelFor", () => {
  it("usa o apelido quando a pasta está liberada (sem diferenciar maiúsculas no Windows)", () => {
    expect(labelFor("/tmp/Proj/Loja", [{ alias: "loja", path: "/tmp/proj/loja" }], "win32")).toBe("loja");
  });

  it("usa o nome da pasta quando não está liberada", () => {
    expect(labelFor("/tmp/Proj/Outra", [], "linux")).toBe("Outra");
  });

  it("corta em 64 caracteres", () => {
    expect(labelFor(`/tmp/${"x".repeat(80)}`, [], "linux")).toHaveLength(64);
  });
});
