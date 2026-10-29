import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    expect(error("c", path.toUpperCase(), "win32")).toBe("essa pasta já está liberada como a");
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
});
