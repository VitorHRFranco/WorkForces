import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeStore, type SecretBox } from "../src/offices/store.js";

const box = (available = true): SecretBox => ({
  available: () => available,
  seal: (plain) => Buffer.from(`cofre:${plain}`).toString("base64"),
  open: (sealed) => {
    const text = Buffer.from(sealed, "base64").toString();
    if (!text.startsWith("cofre:")) throw new Error("não abre");
    return text.slice("cofre:".length);
  },
});

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-store-"));
  file = join(dir, "offices.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

describe("OfficeStore", () => {
  it("guarda o escritório e a sessão cifrada, e lê de volta", () => {
    OfficeStore.load(file, box()).saveLogin("https://e.exemplo", "ana", "sessao-1");
    expect(readFileSync(file, "utf8")).not.toContain("sessao-1");
    const last = OfficeStore.load(file, box()).lastUsed();
    expect(last).toMatchObject({ session: "sessao-1", userName: "ana" });
  });

  it("sem cofre disponível, a sessão fica só na memória", () => {
    const store = OfficeStore.load(file, box(false));
    const saved = store.saveLogin("https://e.exemplo", "ana", "sessao-1");
    expect(store.get(saved.id)!.session).toBe("sessao-1");
    expect(readFileSync(file, "utf8")).toContain('"session":null');
    expect(OfficeStore.load(file, box(false)).lastUsed()!.session).toBeNull();
  });

  it("arquivo corrompido vira lista vazia e uma cópia .bad", () => {
    writeFileSync(file, "{oops");
    const log: string[] = [];
    const store = OfficeStore.load(file, box(), (m) => log.push(m));
    expect(store.list()).toEqual([]);
    expect(existsSync(file + ".bad")).toBe(true);
    expect(log).toHaveLength(1);
    store.saveLogin("https://e.exemplo", "ana", "s1");
    expect(OfficeStore.load(file, box()).list()).toHaveLength(1);
  });

  it("versão desconhecida também vira lista vazia", () => {
    writeFileSync(file, '{"version":2,"lastUsed":null,"offices":[]}');
    expect(OfficeStore.load(file, box()).list()).toEqual([]);
    expect(existsSync(file + ".bad")).toBe(true);
  });

  it("sessão que não decifra (outro usuário do Windows) pede login de novo", () => {
    writeFileSync(file, JSON.stringify({ version: 1, lastUsed: "a", offices: [{ id: "a", url: "https://e.exemplo", userName: "ana", session: "lixo" }] }));
    const store = OfficeStore.load(file, box());
    expect(store.list()).toHaveLength(1);
    expect(store.get("a")).toMatchObject({ userName: "ana", session: null });
  });

  it("mesmo endereço e nome atualizam a entrada; outro nome vira outra", () => {
    const store = OfficeStore.load(file, box());
    store.saveLogin("https://e.exemplo", "ana", "s1");
    store.saveLogin("https://e.exemplo", "ana", "s2");
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.session).toBe("s2");
    store.saveLogin("https://e.exemplo", "bia", "s3");
    expect(store.list()).toHaveLength(2);
    expect(store.lastUsed()!.userName).toBe("bia");
  });

  it("esquecer tira da lista e do último usado", () => {
    const store = OfficeStore.load(file, box());
    const saved = store.saveLogin("https://e.exemplo", "ana", "s1");
    store.forget(saved.id);
    expect(store.list()).toEqual([]);
    expect(store.lastUsed()).toBeNull();
    const again = OfficeStore.load(file, box());
    expect(again.list()).toEqual([]);
    expect(again.lastUsed()).toBeNull();
  });
});
