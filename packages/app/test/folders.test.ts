import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderStore } from "../src/agents/folders.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-folders-"));
  file = join(dir, "agents.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const makeDir = (name: string): string => {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
};

describe("FolderStore", () => {
  it("libera, lista e remove; pasta apagada aparece como não existe mais", () => {
    const path = makeDir("projeto");
    const store = FolderStore.load(file);
    expect(store.add("proj", path)).toEqual({ ok: true, folders: [{ alias: "proj", path, exists: true }] });
    expect(FolderStore.load(file).find("proj")).toEqual({ alias: "proj", path });
    rmSync(path, { recursive: true });
    expect(store.list()[0]!.exists).toBe(false);
    expect(store.remove("proj")).toEqual([]);
    expect(FolderStore.load(file).list()).toEqual([]);
  });

  it("recusa fora da regra, com a mensagem de hoje", () => {
    const path = makeDir("a");
    const store = FolderStore.load(file);
    const error = (alias: string, p: string, platform?: NodeJS.Platform) => {
      const result = store.add(alias, p, platform);
      return result.ok ? null : result.error;
    };
    expect(error("Maiúsculo", path)).toBe("apelido inválido: use até 32 letras minúsculas, números e hífen, começando por letra ou número");
    expect(error("a", join(dir, "nao-existe"))).toBe(`não é uma pasta: ${join(dir, "nao-existe")}`);
    const semi = makeDir("x;y");
    expect(error("a", semi)).toBe("o caminho não pode ter ; (o Windows Terminal não abre a pasta)");
    expect(store.add("a", path).ok).toBe(true);
    expect(error("a", makeDir("b"))).toBe("o apelido a já está em uso");
    makeDir("A");
    expect(error("c", join(dir, "A"), "win32")).toBe("essa pasta já está liberada como a");
    const many = FolderStore.load(join(dir, "muitas.json"));
    for (let i = 0; i < 50; i++) expect(many.add(`p${i}`, makeDir(`p${i}`)).ok).toBe(true);
    expect(many.add("extra", makeDir("extra"))).toEqual({ ok: false, error: "no máximo 50 pastas" });
  });

  it("arquivo corrompido vira lista vazia e cópia .bad", () => {
    writeFileSync(file, "{oops");
    const log: string[] = [];
    const store = FolderStore.load(file, (m) => log.push(m));
    expect(store.list()).toEqual([]);
    expect(store.secretPatterns()).toEqual([]);
    expect(existsSync(`${file}.bad`)).toBe(true);
    expect(log).toHaveLength(1);
  });

  it("erro de leitura que não é arquivo ausente não deixa o add sobrescrever o arquivo", () => {
    mkdirSync(file);
    const log: string[] = [];
    const store = FolderStore.load(file, (m) => log.push(m));
    expect(log).toHaveLength(1);
    expect(() => store.add("a", makeDir("a"))).not.toThrow();
    expect(statSync(file).isDirectory()).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("padrões de máscara acima do limite do canal são cortados", () => {
    const patterns = [...Array.from({ length: 52 }, (_, i) => `p${i}`), "x".repeat(501)];
    writeFileSync(file, JSON.stringify({ version: 1, folders: [], secretPatterns: patterns }));
    const log: string[] = [];
    const kept = FolderStore.load(file, (m) => log.push(m)).secretPatterns();
    expect(kept).toEqual(patterns.slice(0, 50));
    expect(log).toHaveLength(1);
    writeFileSync(file, JSON.stringify({ version: 1, folders: [], secretPatterns: ["x".repeat(501), "ok"] }));
    expect(FolderStore.load(file).secretPatterns()).toEqual(["ok"]);
  });

  it("entradas editadas à mão que quebram as regras saem ao carregar", () => {
    const good = makeDir("boa");
    const folders = [
      { alias: "boa", path: good },
      { alias: "ponto", path: join(dir, "a;b") },
      { alias: "boa", path: makeDir("outra") },
      { alias: "copia", path: good },
      { alias: "Ruim", path: makeDir("ruim") },
      { alias: "rel", path: "relativo/pasta" },
    ];
    writeFileSync(file, JSON.stringify({ version: 1, folders, secretPatterns: [] }));
    const log: string[] = [];
    const store = FolderStore.load(file, (m) => log.push(m));
    expect(store.list().map((f) => f.alias)).toEqual(["boa"]);
    expect(log).toHaveLength(5);
  });

  it("falha ao gravar devolve o erro e mantém a lista como estava", () => {
    const store = FolderStore.load(file);
    expect(store.add("a", makeDir("a")).ok).toBe(true);
    mkdirSync(`${file}.tmp`);
    expect(store.add("b", makeDir("b"))).toEqual({ ok: false, error: "não consegui salvar a lista de pastas; tente de novo" });
    expect(store.list().map((f) => f.alias)).toEqual(["a"]);
    expect(store.remove("a")).toHaveLength(1);
    expect(store.remove("nada")).toHaveLength(1);
  });
});
