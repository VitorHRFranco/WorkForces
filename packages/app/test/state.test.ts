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

const INVITE = { server: "http://localhost:4600", code: "abc", pin: null };

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
    expect(state.openInvite(INVITE, null)).toEqual({ page: "invite", code: "abc" });
    expect(state.current()).toEqual({ id: null, url: "http://localhost:4600", host: "localhost:4600", userName: null, loggedIn: false, sessionExpired: false });
  });

  it("convite com pino guarda a âncora, e ela volta pelo alvo, pelo escritório dos agentes e pelo teste de rede", () => {
    const pin = "B".repeat(43);
    const state = fresh();
    state.openInvite({ server: "https://192.168.0.10:4600", code: "abc", pin }, "PEM");
    expect(state.target()).toEqual({ url: "https://192.168.0.10:4600", session: null, anchor: "PEM" });
    state.applyAuth({ session: "s1", userName: "ana" });
    const saved = state.list()[0]!;
    expect(OfficeStore.load(file, box).get(saved.id)).toMatchObject({ pin, anchor: "PEM" });
    expect(state.agentOffice()).toMatchObject({ anchor: "PEM" });
    expect(state.reachTarget(saved.id)).toEqual({ url: "https://192.168.0.10:4600", anchor: "PEM" });
    expect(state.reachTarget("nao-existe")).toBeNull();
    const next = fresh();
    next.startup();
    expect(next.target()!.anchor).toBe("PEM");
    expect(next.open(saved.id)).toEqual({ page: "office" });
    expect(next.target()!.anchor).toBe("PEM");
  });

  it("perfil corrompido abre a tela inicial com o aviso, em vez de uma lista vazia calada", () => {
    writeFileSync(file, "{oops");
    expect(fresh().startup()).toEqual({ page: "launcher", notice: "não consegui ler os escritórios salvos; guardei uma cópia em offices.json.bad" });
  });

  it("perfil que não pôde ser lido avisa o que fazer", () => {
    mkdirSync(file);
    expect(fresh().startup()).toEqual({
      page: "launcher",
      notice: "não consegui ler os escritórios salvos; feche outros programas que usem a pasta do WorkForces e abra de novo",
    });
  });

  it("perfil novo abre a tela inicial sem aviso", () => {
    expect(fresh().startup()).toEqual({ page: "launcher" });
  });

  it("a sessão entregue no login salva o escritório e vira o último usado", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    expect(state.list()).toEqual([expect.objectContaining({ host: "localhost:4600", userName: "ana", loggedIn: true })]);
    const next = fresh();
    expect(next.startup()).toEqual({ page: "office" });
    expect(next.target()).toEqual({ url: "http://localhost:4600", session: "s1", anchor: null });
  });

  it("sessão recusada pelo servidor apaga a sessão e avisa no login", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.unauthorized();
    expect(state.current()).toMatchObject({ sessionExpired: true, loggedIn: false });
    expect(fresh().startup()).toEqual({ page: "launcher" });
  });

  it("logout (cookie apagado) tira a sessão", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.applyAuth({ session: null, userName: null });
    expect(state.current()).toMatchObject({ loggedIn: false });
    expect(fresh().startup()).toEqual({ page: "launcher" });
  });

  it("Já tenho conta: endereço vira login; endereço ruim fica na tela inicial", () => {
    const state = fresh();
    expect(state.add("escritorio.exemplo")).toEqual({ page: "login" });
    expect(state.current()!.url).toBe("https://escritorio.exemplo");
    expect(state.add("http://10.0.0.5")).toMatchObject({ page: "launcher", notice: expect.any(String) });
  });

  it("esquecer o escritório aberto fecha ele", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.forget(state.current()!.id!);
    expect(state.current()).toBeNull();
    expect(state.target()).toBeNull();
  });

  it("trocar de escritório nunca leva a sessão do anterior", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    state.openInvite({ server: "https://outro.exemplo", code: "abc", pin: null }, null);
    expect(state.target()).toEqual({ url: "https://outro.exemplo", session: null, anchor: null });
    state.applyAuth({ session: "s1", userName: "ana" });
    state.add("terceiro.exemplo");
    expect(state.target()).toEqual({ url: "https://terceiro.exemplo", session: null, anchor: null });
  });

  it("agentOffice só existe com escritório aberto e conta salva; saveBridgeToken grava na conta aberta", () => {
    const state = fresh();
    expect(state.agentOffice()).toBeNull();
    state.openInvite(INVITE, null);
    expect(state.agentOffice()).toBeNull();
    state.applyAuth({ session: "s1", userName: "ana" });
    const office = state.agentOffice()!;
    expect(office).toMatchObject({ url: "http://localhost:4600", userName: "ana", session: "s1", bridgeToken: null });
    state.saveBridgeToken(office.id, "ponte");
    expect(state.agentOffice()).toMatchObject({ id: office.id, bridgeToken: "ponte" });
    const next = fresh();
    next.startup();
    expect(next.agentOffice()).toMatchObject({ bridgeToken: "ponte" });
  });

  it("escritório salvo sem nome de conta não abre agentes", () => {
    const entry = { id: "sem-nome", url: "http://localhost:4600", userName: null, session: null, bridgeToken: null };
    writeFileSync(file, JSON.stringify({ version: 1, lastUsed: null, offices: [entry] }));
    const state = fresh();
    state.open("sem-nome");
    expect(state.current()).toMatchObject({ id: "sem-nome", userName: null });
    expect(state.agentOffice()).toBeNull();
  });

  it("token criado para outro escritório vai para o id dele e não muda o aberto", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.applyAuth({ session: "s1", userName: "ana" });
    const a = state.agentOffice()!;
    state.openInvite({ server: "http://localhost:4700", code: "abc", pin: null }, null);
    state.applyAuth({ session: "s2", userName: "bia" });
    const b = state.agentOffice()!;
    state.saveBridgeToken(a.id, "token-de-a");
    expect(state.agentOffice()).toMatchObject({ id: b.id, bridgeToken: null });
    expect(OfficeStore.load(file, box).get(a.id)).toMatchObject({ bridgeToken: "token-de-a" });
    expect(OfficeStore.load(file, box).get(b.id)).toMatchObject({ bridgeToken: null });
  });
  describe("changeAddress", () => {
    const PIN = "C".repeat(43);
    /** Só o escritório com pino troca de endereço: o pino prova que o endereço novo é o mesmo escritório. */
    const saved = (state: AppState, server: string, name: string, pin: string | null = PIN) => {
      state.openInvite({ server, code: "abc", pin }, pin === null ? null : "PEM");
      state.applyAuth({ session: `s-${name}`, userName: name });
      return state.agentOffice()!.id;
    };

    it("aceita endereço sem https:// e fecha o escritório trocado se era o aberto", () => {
      const state = fresh();
      const id = saved(state, "https://192.168.0.10:4600", "ana");
      expect(state.changeAddress(id, "192.168.0.20:4600")).toEqual({ ok: true });
      expect(state.list()[0]!.url).toBe("https://192.168.0.20:4600");
      expect(state.current()).toBeNull();
    });

    it("não fecha o aberto quando troca o endereço de outro", () => {
      const state = fresh();
      const a = saved(state, "https://192.168.0.10:4600", "ana");
      saved(state, "https://192.168.0.10:4700", "bia");
      expect(state.changeAddress(a, "192.168.0.20:4600")).toEqual({ ok: true });
      expect(state.current()).not.toBeNull();
    });

    it("recusa endereço inválido, duplicado e id sumido, com a mensagem de cada caso", () => {
      const state = fresh();
      const a = saved(state, "https://192.168.0.10:4600", "ana");
      saved(state, "https://192.168.0.10:4700", "ana");
      expect(state.changeAddress(a, "")).toEqual({ ok: false, error: expect.any(String) });
      expect(state.changeAddress(a, "https://192.168.0.10:4700")).toEqual({ ok: false, error: "esse endereço já está salvo com a mesma conta; esqueça um dos dois antes" });
      expect(state.changeAddress("nao-existe", "192.168.0.20:4600")).toEqual({ ok: false, error: "esse escritório não está mais na lista" });
      expect(state.current()).not.toBeNull();
    });

    it("escritório sem pino não troca de endereço: pede um convite novo, e o endereço fica", () => {
      const state = fresh();
      const id = saved(state, "https://escritorio.exemplo", "ana", null);
      expect(state.changeAddress(id, "https://golpe.exemplo")).toEqual({
        ok: false,
        error: "esse escritório não tem pino: para mudar o endereço, peça um convite novo a quem cuida dele",
      });
      expect(state.list()[0]!.url).toBe("https://escritorio.exemplo");
      expect(state.current()).not.toBeNull();
    });

    it("com pino, o endereço novo precisa ser https: o pino não vale em http", () => {
      const state = fresh();
      const id = saved(state, "https://192.168.0.10:4600", "ana");
      expect(state.changeAddress(id, "http://127.0.0.1:4600")).toEqual({ ok: false, error: "use um endereço https:// (o pino só vale com https)" });
      expect(state.list()[0]!.url).toBe("https://192.168.0.10:4600");
      expect(state.changeAddress(id, "https://127.0.0.1:4600")).toEqual({ ok: true });
      expect(state.list()[0]!.url).toBe("https://127.0.0.1:4600");
    });

    it("list diz quais escritórios têm pino", () => {
      const state = fresh();
      saved(state, "https://192.168.0.10:4600", "ana");
      saved(state, "https://escritorio.exemplo", "ana", null);
      expect(state.list().map((office) => [office.url, office.pinned])).toEqual([
        ["https://192.168.0.10:4600", true],
        ["https://escritorio.exemplo", false],
      ]);
    });
  });

  it("close fecha o escritório aberto", () => {
    const state = fresh();
    state.openInvite(INVITE, null);
    state.close();
    expect(state.current()).toBeNull();
    expect(state.target()).toBeNull();
  });

  describe("escritório deste computador", () => {
    const HOSTED_PIN = "H".repeat(43);
    const LOCAL = "https://127.0.0.1:4600";

    it("list marca hosted só na entrada com o pino do anfitrião, e findHosted dá o id dela", () => {
      let hostedPin: string | null = null;
      const state = new AppState(OfficeStore.load(file, box), () => hostedPin);
      state.openInvite({ server: LOCAL, code: "abc", pin: HOSTED_PIN }, "PEM");
      state.applyAuth({ session: "s1", userName: "ana" });
      state.openInvite({ server: "https://outro.exemplo", code: "abc", pin: "O".repeat(43) }, "OUTRA");
      state.applyAuth({ session: "s2", userName: "ana" });
      expect(state.list().map((office) => office.hosted)).toEqual([false, false]);
      expect(state.findHosted()).toBeNull();
      hostedPin = HOSTED_PIN;
      const list = state.list();
      expect(list.map((office) => [office.url, office.hosted])).toEqual([
        [LOCAL, true],
        ["https://outro.exemplo", false],
      ]);
      expect(state.findHosted()).toBe(list[0]!.id);
    });

    it("openPending leva ao login, com a âncora no alvo; o login salva a entrada com o pino", () => {
      const state = new AppState(OfficeStore.load(file, box), () => HOSTED_PIN);
      expect(state.openPending(LOCAL, HOSTED_PIN, "PEM")).toEqual({ page: "login" });
      expect(state.target()).toEqual({ url: LOCAL, session: null, anchor: "PEM" });
      state.applyAuth({ session: "s1", userName: "ana" });
      expect(OfficeStore.load(file, box).list()).toEqual([expect.objectContaining({ url: LOCAL, pin: HOSTED_PIN, anchor: "PEM" })]);
      expect(state.findHosted()).toBe(state.current()!.id);
    });

    it("abrir o app com o escritório deste computador como último usado vai à tela inicial, não para dentro dele", () => {
      const state = new AppState(OfficeStore.load(file, box), () => HOSTED_PIN);
      state.openInvite({ server: "https://outro.exemplo", code: "abc", pin: "O".repeat(43) }, "OUTRA");
      state.applyAuth({ session: "s2", userName: "ana" });
      state.openInvite({ server: LOCAL, code: "abc", pin: HOSTED_PIN }, "PEM");
      state.applyAuth({ session: "s1", userName: "ana" });
      expect(new AppState(OfficeStore.load(file, box), () => HOSTED_PIN).startup()).toEqual({ page: "launcher" });
      expect(new AppState(OfficeStore.load(file, box), () => null).startup()).toEqual({ page: "office" });
    });
  });
});
