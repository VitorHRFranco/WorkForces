import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const NO_TLS = { pin: null, anchor: null };

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-store-"));
  file = join(dir, "offices.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

describe("OfficeStore", () => {
  it("guarda o escritório e a sessão cifrada, e lê de volta", () => {
    OfficeStore.load(file, box()).saveLogin("https://e.exemplo", "ana", "sessao-1", NO_TLS);
    expect(readFileSync(file, "utf8")).not.toContain("sessao-1");
    const last = OfficeStore.load(file, box()).lastUsed();
    expect(last).toMatchObject({ session: "sessao-1", userName: "ana" });
  });

  it("sem cofre disponível, a sessão fica só na memória", () => {
    const store = OfficeStore.load(file, box(false));
    const saved = store.saveLogin("https://e.exemplo", "ana", "sessao-1", NO_TLS);
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
    expect(log).toEqual([expect.stringContaining("copiado para")]);
    expect(store.problem).toBe("não consegui ler os escritórios salvos; guardei uma cópia em offices.json.bad");
    store.saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    expect(OfficeStore.load(file, box()).list()).toHaveLength(1);
  });

  it("perfil novo ou lido sem erro não tem aviso", () => {
    expect(OfficeStore.load(file, box()).problem).toBeNull();
    OfficeStore.load(file, box()).saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    expect(OfficeStore.load(file, box()).problem).toBeNull();
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
    store.saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    store.saveLogin("https://e.exemplo", "ana", "s2", NO_TLS);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.session).toBe("s2");
    store.saveLogin("https://e.exemplo", "bia", "s3", NO_TLS);
    expect(store.list()).toHaveLength(2);
    expect(store.lastUsed()!.userName).toBe("bia");
  });

  it("offices.json antigo, sem pin nem anchor, carrega com os dois nulos", () => {
    writeFileSync(file, JSON.stringify({ version: 1, lastUsed: null, offices: [{ id: "a", url: "https://e.exemplo", userName: "ana", session: null, bridgeToken: null }] }));
    expect(OfficeStore.load(file, box()).get("a")).toMatchObject({ pin: null, anchor: null });
  });

  it("pin e anchor são gravados em claro (a âncora é pública), voltam ao recarregar e são atualizados na entrada existente", () => {
    const pin = "C".repeat(43);
    const store = OfficeStore.load(file, box());
    store.saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    store.saveLogin("https://e.exemplo", "ana", "s1", { pin, anchor: "PEM" });
    expect(readFileSync(file, "utf8")).toContain('"anchor":"PEM"');
    expect(OfficeStore.load(file, box()).list()).toEqual([expect.objectContaining({ pin, anchor: "PEM" })]);
  });

  describe("saveLogin com pino", () => {
    const URL_LAN = "https://192.168.0.10:4600";
    const A = { pin: "A".repeat(43), anchor: "PEM-A" };
    const B = { pin: "B".repeat(43), anchor: "PEM-B" };

    it("pinos diferentes no mesmo endereço e nome são escritórios diferentes: a entrada antiga fica como estava", () => {
      const store = OfficeStore.load(file, box());
      const a = store.saveLogin(URL_LAN, "ana", "s-a", A);
      store.setBridgeToken(a.id, "token-de-a");
      const b = store.saveLogin(URL_LAN, "ana", "s-b", B);
      expect(b.id).not.toBe(a.id);
      expect(b).toMatchObject({ session: "s-b", bridgeToken: null, ...B });
      const reloaded = OfficeStore.load(file, box());
      expect(reloaded.list()).toHaveLength(2);
      expect(reloaded.get(a.id)).toMatchObject({ session: "s-a", bridgeToken: "token-de-a", ...A });
      expect(reloaded.get(b.id)).toMatchObject({ session: "s-b", bridgeToken: null, ...B });
      expect(reloaded.lastUsed()!.id).toBe(b.id);
    });

    it("mesmo pino atualiza a sessão da mesma entrada", () => {
      const store = OfficeStore.load(file, box());
      const first = store.saveLogin(URL_LAN, "ana", "s1", A);
      store.setBridgeToken(first.id, "tok");
      const again = store.saveLogin(URL_LAN, "ana", "s2", A);
      expect(again.id).toBe(first.id);
      expect(store.list()).toHaveLength(1);
      expect(store.get(first.id)).toMatchObject({ session: "s2", bridgeToken: "tok", ...A });
    });

    it("login sem pino no endereço de uma entrada com pino cria outra; a com pino continua com ele", () => {
      const store = OfficeStore.load(file, box());
      const pinned = store.saveLogin(URL_LAN, "ana", "s1", A);
      store.setBridgeToken(pinned.id, "tok");
      const plain = store.saveLogin(URL_LAN, "ana", "s2", NO_TLS);
      expect(plain.id).not.toBe(pinned.id);
      expect(plain).toMatchObject({ session: "s2", bridgeToken: null, pin: null, anchor: null });
      expect(store.get(pinned.id)).toMatchObject({ session: "s1", bridgeToken: "tok", ...A });
    });

    it("trocar o endereço é duplicado só quando a outra entrada tem também o mesmo pino", () => {
      const store = OfficeStore.load(file, box());
      const a = store.saveLogin("https://a.exemplo", "ana", "s1", A);
      store.saveLogin("https://b.exemplo", "ana", "s2", A);
      store.saveLogin("https://c.exemplo", "ana", "s3", B);
      expect(store.setUrl(a.id, "https://b.exemplo")).toBe("duplicate");
      expect(store.get(a.id)!.url).toBe("https://a.exemplo");
      expect(store.setUrl(a.id, "https://c.exemplo")).toBe("ok");
      expect(store.get(a.id)).toMatchObject({ url: "https://c.exemplo", ...A });
    });
  });

  it("pin sem anchor, ou o contrário, deixa o arquivo ilegível", () => {
    for (const tls of [{ pin: "C".repeat(43), anchor: null }, { pin: null, anchor: "PEM" }]) {
      rmSync(file + ".bad", { force: true });
      writeFileSync(file, JSON.stringify({ version: 1, lastUsed: "a", offices: [{ id: "a", url: "https://e.exemplo", userName: "ana", session: null, ...tls }] }));
      expect(OfficeStore.load(file, box()).list()).toEqual([]);
      expect(existsSync(file + ".bad")).toBe(true);
    }
  });

  it("esquecer tira da lista e do último usado", () => {
    const store = OfficeStore.load(file, box());
    const saved = store.saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    store.forget(saved.id);
    expect(store.list()).toEqual([]);
    expect(store.lastUsed()).toBeNull();
    const again = OfficeStore.load(file, box());
    expect(again.list()).toEqual([]);
    expect(again.lastUsed()).toBeNull();
  });

  it("trocar o endereço mantém conta, token, pino e âncora, e sobrevive ao recarregar", () => {
    const store = OfficeStore.load(file, box());
    const saved = store.saveLogin("https://a.exemplo", "ana", "s1", { pin: "C".repeat(43), anchor: "PEM" });
    store.setBridgeToken(saved.id, "tok");
    expect(store.setUrl(saved.id, "https://b.exemplo")).toBe("ok");
    const expected = { url: "https://b.exemplo", userName: "ana", session: "s1", bridgeToken: "tok", pin: "C".repeat(43), anchor: "PEM" };
    expect(store.get(saved.id)).toMatchObject(expected);
    expect(OfficeStore.load(file, box()).get(saved.id)).toMatchObject(expected);
  });

  it("trocar o endereço para um já salvo com a mesma conta é duplicado; id desconhecido é missing", () => {
    const store = OfficeStore.load(file, box());
    store.saveLogin("https://a.exemplo", "ana", "s1", NO_TLS);
    const other = store.saveLogin("https://b.exemplo", "ana", "s2", NO_TLS);
    expect(store.setUrl(other.id, "https://a.exemplo")).toBe("duplicate");
    expect(store.get(other.id)!.url).toBe("https://b.exemplo");
    expect(store.setUrl("nao-existe", "https://c.exemplo")).toBe("missing");
  });

  it("endereço inválido ou http fora de localhost no arquivo vira lista vazia e uma cópia .bad", () => {
    for (const url of ["x", "http://10.0.0.5"]) {
      rmSync(file + ".bad", { force: true });
      writeFileSync(file, JSON.stringify({ version: 1, lastUsed: "a", offices: [{ id: "a", url, userName: "ana", session: null }] }));
      expect(OfficeStore.load(file, box()).list(), url).toEqual([]);
      expect(existsSync(file + ".bad"), url).toBe(true);
    }
  });

  it("erro de leitura que não é arquivo ausente é registrado, avisa e não grava por cima nesta execução", () => {
    // Uma pasta no lugar do arquivo dá EISDIR, como um bloqueio do antivírus daria EBUSY.
    mkdirSync(file);
    const log: string[] = [];
    const store = OfficeStore.load(file, box(), (m) => log.push(m));
    expect(store.list()).toEqual([]);
    expect(log).toHaveLength(1);
    // A cópia .bad não foi feita (é uma pasta): o registro não pode dizer que foi.
    expect(log[0]).not.toContain("copiado para");
    expect(existsSync(file + ".bad")).toBe(false);
    expect(store.problem).toBe("não consegui ler os escritórios salvos; feche outros programas que usem a pasta do WorkForces e abra de novo");
    // A lista funciona na memória, mas nada é gravado no lugar do arquivo de verdade.
    const saved = store.saveLogin("https://e.exemplo", "ana", "s1", NO_TLS);
    expect(store.get(saved.id)).toMatchObject({ session: "s1" });
    expect(statSync(file).isDirectory()).toBe(true);
    expect(existsSync(file + ".tmp")).toBe(false);
  });

  it("o token da ponte é guardado cifrado e volta ao reabrir", () => {
    const store = OfficeStore.load(file, box());
    const saved = store.saveLogin("https://e.exemplo", "ana", "sessao-1", NO_TLS);
    store.setBridgeToken(saved.id, "ponte-secreta");
    expect(readFileSync(file, "utf8")).not.toContain("ponte-secreta");
    expect(OfficeStore.load(file, box()).get(saved.id)).toMatchObject({ bridgeToken: "ponte-secreta" });
    // Perfil do plano 1, sem o campo, ainda abre.
    writeFileSync(file, JSON.stringify({ version: 1, lastUsed: null, offices: [{ id: "a", url: "https://e.exemplo", userName: "ana", session: null }] }));
    expect(OfficeStore.load(file, box()).get("a")).toMatchObject({ bridgeToken: null });
  });
});
