import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeStore, type SecretBox } from "../src/offices/store.js";
import { AppState } from "../src/state.js";

const box: SecretBox = {
  available: () => true,
  seal: (plain) => Buffer.from(`cofre:${plain}`).toString("base64"),
  open: (sealed) => {
    const text = Buffer.from(sealed, "base64").toString();
    if (!text.startsWith("cofre:")) throw new Error("não abre");
    return text.slice("cofre:".length);
  },
};

const LINK = "workforces://invite?server=http%3A%2F%2Flocalhost%3A4600&code=abc";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-state-"));
  file = join(dir, "offices.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const fresh = () => new AppState(OfficeStore.load(file, box));

describe("AppState", () => {
  it("convite pela linha de comando abre a criação da conta naquele escritório", () => {
    const state = fresh();
    expect(state.startup(LINK)).toEqual({ page: "invite", code: "abc" });
    expect(state.current()).toEqual({ id: null, url: "http://localhost:4600", host: "localhost:4600", userName: null, loggedIn: false, sessionExpired: false });
  });

  it("link inválido volta à tela inicial com o motivo", () => {
    const state = fresh();
    const route = state.startup("workforces://invite?server=http%3A%2F%2F10.0.0.5&code=abc");
    expect(route).toMatchObject({ page: "launcher", notice: expect.stringContaining("https") });
    expect(state.current()).toBeNull();
  });

  it("perfil corrompido abre a tela inicial com o aviso, em vez de uma lista vazia calada", () => {
    writeFileSync(file, "{oops");
    expect(fresh().startup(null)).toEqual({ page: "launcher", notice: "não consegui ler os escritórios salvos; guardei uma cópia em offices.json.bad" });
  });

  it("perfil que não pôde ser lido avisa o que fazer", () => {
    mkdirSync(file);
    expect(fresh().startup(null)).toEqual({
      page: "launcher",
      notice: "não consegui ler os escritórios salvos; feche outros programas que usem a pasta do WorkForces e abra de novo",
    });
  });

  it("perfil novo abre a tela inicial sem aviso", () => {
    expect(fresh().startup(null)).toEqual({ page: "launcher" });
  });

  it("a sessão entregue no login salva o escritório e vira o último usado", () => {
    const state = fresh();
    state.openLink(LINK);
    state.applyAuth({ session: "s1", userName: "ana" });
    expect(state.list()).toEqual([expect.objectContaining({ host: "localhost:4600", userName: "ana", loggedIn: true })]);
    const next = fresh();
    expect(next.startup(null)).toEqual({ page: "office" });
    expect(next.target()).toEqual({ url: "http://localhost:4600", session: "s1" });
  });

  it("sessão recusada pelo servidor apaga a sessão e avisa no login", () => {
    const state = fresh();
    state.openLink(LINK);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.unauthorized();
    expect(state.current()).toMatchObject({ sessionExpired: true, loggedIn: false });
    expect(fresh().startup(null)).toEqual({ page: "launcher" });
  });

  it("logout (cookie apagado) tira a sessão", () => {
    const state = fresh();
    state.openLink(LINK);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.applyAuth({ session: null, userName: null });
    expect(state.current()).toMatchObject({ loggedIn: false });
    expect(fresh().startup(null)).toEqual({ page: "launcher" });
  });

  it("Já tenho conta: endereço vira login; endereço ruim fica na tela inicial", () => {
    const state = fresh();
    expect(state.add("escritorio.exemplo")).toEqual({ page: "login" });
    expect(state.current()!.url).toBe("https://escritorio.exemplo");
    expect(state.add("http://10.0.0.5")).toMatchObject({ page: "launcher", notice: expect.any(String) });
  });

  it("esquecer o escritório aberto fecha ele", () => {
    const state = fresh();
    state.openLink(LINK);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.forget(state.current()!.id!);
    expect(state.current()).toBeNull();
    expect(state.target()).toBeNull();
  });

  it("trocar de escritório nunca leva a sessão do anterior", () => {
    const other = "workforces://invite?server=https%3A%2F%2Foutro.exemplo&code=abc";
    const state = fresh();
    state.openLink(LINK);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.openLink(other);
    expect(state.target()).toEqual({ url: "https://outro.exemplo", session: null });
    state.applyAuth({ session: "s1", userName: "ana" });
    state.add("terceiro.exemplo");
    expect(state.target()).toEqual({ url: "https://terceiro.exemplo", session: null });
  });
});
