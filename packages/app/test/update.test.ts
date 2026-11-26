import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, restartToUpdate, startUpdates, takeResumeMark, updateFeed, writeResumeMark, type Updater } from "../src/update.js";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  failNext = false;
  throwNext = false;
  quitAndInstall = vi.fn();
  checkForUpdates(): Promise<unknown> {
    this.checks++;
    if (this.throwNext) throw new Error("quebrou");
    return this.failNext ? Promise.reject(new Error("sem rede")) : Promise.resolve(null);
  }
}

const START = "atualização: verificando os Releases";
const DONE = "atualização: verificação terminou";

describe("startUpdates", () => {
  let updater: FakeUpdater;
  const notify = vi.fn();
  const log = vi.fn();
  const start = (enabled = true) => startUpdates({ updater: updater as unknown as Updater, enabled, notify, log });

  beforeEach(() => {
    vi.useFakeTimers();
    updater = new FakeUpdater();
    notify.mockClear();
    log.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("desligado: nunca verifica", async () => {
    const updates = start(false);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(0);
    expect(updates.downloaded()).toBeNull();
  });

  it("ligado: baixa sozinho, instala ao sair, verifica em 10 s e depois a cada 6 h", async () => {
    start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(updater.checks).toBe(1);
    // O começo e o fim de cada verificação vão ao log (o E2E do app instalado espera por eles), nunca à tela.
    expect(log.mock.calls.map(([line]) => line)).toEqual([START, DONE]);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(updater.checks).toBe(2);
    expect(log.mock.calls.map(([line]) => line)).toEqual([START, DONE, START, DONE]);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(updater.checks).toBe(3);
  });

  it("versão baixada: avisa uma vez só, mesmo com o evento repetido", () => {
    const updates = start();
    updater.emit("update-downloaded", { version: "0.2.0" });
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("0.2.0");
    expect(updates.downloaded()).toBe("0.2.0");
  });

  it("falhas só vão ao log e a próxima verificação acontece", async () => {
    const updates = start();
    updater.failNext = true;
    updater.emit("error", new Error("proxy"));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(updater.checks).toBe(1);
    expect(log.mock.calls.map(([line]) => line)).toEqual(["atualização: proxy", START, "atualização: verificação falhou: sem rede"]);
    // A rotina (começo da verificação) é info; as falhas ficam sem nível (aviso).
    expect(log.mock.calls).toEqual([["atualização: proxy"], [START, "info"], ["atualização: verificação falhou: sem rede"]]);
    expect(notify).not.toHaveBeenCalled();
    expect(updates.downloaded()).toBeNull();
    updater.failNext = false;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(updater.checks).toBe(2);
    expect(log.mock.calls.at(-1)?.[0]).toBe(DONE);
  });

  it("erro síncrono do atualizador: também só vai ao log, e a próxima verificação acontece", async () => {
    start();
    updater.throwNext = true;
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(log.mock.calls.map(([line]) => line)).toEqual([START, "atualização: verificação falhou: quebrou"]);
    updater.throwNext = false;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(updater.checks).toBe(2);
    expect(log.mock.calls.at(-1)?.[0]).toBe(DONE);
  });

  it("stop cancela os timers", async () => {
    const updates = start();
    updates.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(0);
  });
});

describe("updateFeed", () => {
  it("aceita só http em 127.0.0.1 ou localhost", () => {
    expect(updateFeed({ WF_UPDATE_URL: "http://127.0.0.1:8123/feed" })).toEqual({ provider: "generic", url: "http://127.0.0.1:8123/feed" });
    expect(updateFeed({ WF_UPDATE_URL: "http://localhost:8123/" })).toEqual({ provider: "generic", url: "http://localhost:8123/" });
  });

  it("recusa qualquer outro endereço, e sem a variável não troca nada", () => {
    for (const url of ["https://127.0.0.1:1/", "http://192.168.0.5:1/", "http://exemplo.com/", "file:///C:/x", "http://127.0.0.1.exemplo.com/", "nada"]) {
      expect(updateFeed({ WF_UPDATE_URL: url })).toBeNull();
    }
    expect(updateFeed({})).toBeNull();
  });
});

describe("restartToUpdate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("se o app não sai no prazo, avisa; uma segunda chamada não reinstala de novo", async () => {
    const quitAndInstall = vi.fn();
    const onFailed = vi.fn();
    restartToUpdate({ quitAndInstall, onFailed, timeoutMs: 15_000 });
    restartToUpdate({ quitAndInstall, onFailed, timeoutMs: 15_000 });
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onFailed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    // Depois da falha, a pessoa pode tentar de novo.
    restartToUpdate({ quitAndInstall, onFailed, timeoutMs: 15_000 });
    expect(quitAndInstall).toHaveBeenCalledTimes(2);
  });
});

describe("marca de religar o escritório", () => {
  it("vale uma vez só", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-religar-"));
    try {
      writeResumeMark(dir);
      expect(takeResumeMark(dir)).toBe(true);
      expect(takeResumeMark(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("numa pasta que não existe, não há marca", () => {
    expect(takeResumeMark(join(tmpdir(), "wf-nao-existe-" + process.pid, "x"))).toBe(false);
  });
});

describe("só verificar", () => {
  it("download: false não baixa nem instala ao fechar", () => {
    const updater = new FakeUpdater();
    startUpdates({ updater: updater as unknown as Updater, enabled: true, notify: vi.fn(), log: vi.fn(), download: false }).stop();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});
