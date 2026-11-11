import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, startUpdates, type Updater } from "../src/update.js";

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
