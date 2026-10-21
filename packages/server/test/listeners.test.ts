import type { SpawnError } from "@workforces/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Listeners, type ListenerLink, type SpawnRequester } from "../src/realtime/listeners.js";

function listener(userId: number, tokenId = userId * 10) {
  const sent: { reqId: string; alias: string }[] = [];
  const closed: number[] = [];
  const link: ListenerLink = {
    userId,
    tokenId,
    sendSpawn: (reqId, alias) => sent.push({ reqId, alias }),
    close: (code) => closed.push(code),
  };
  return { link, sent, closed };
}

function requester(userId: number) {
  const results: { reqId: string; ok: boolean; error?: SpawnError }[] = [];
  const link: SpawnRequester = { userId, sendResult: (reqId, ok, error) => results.push(error ? { reqId, ok, error } : { reqId, ok }) };
  return { link, results };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Listeners", () => {
  it("o dono vê as pastas de todas as pontes dele, sem repetir e em ordem; os outros não veem nada", () => {
    const listeners = new Listeners();
    const changes: number[] = [];
    listeners.onChange((userId) => changes.push(userId));
    const notebook = listener(1);
    const desktop = listener(1);
    listeners.connect(notebook.link, ["site", "loja"]);
    listeners.connect(desktop.link, ["loja", "api"]);
    expect(listeners.summary(1)).toEqual({ aliases: ["api", "loja", "site"], listenerOnline: true });
    expect(listeners.summary(2)).toEqual({ aliases: [], listenerOnline: false });
    listeners.update(desktop.link, []);
    expect(listeners.summary(1).aliases).toEqual(["loja", "site"]);
    listeners.disconnect(notebook.link);
    listeners.disconnect(desktop.link);
    expect(listeners.summary(1)).toEqual({ aliases: [], listenerOnline: false });
    expect(changes).toEqual([1, 1, 1, 1, 1]);
  });

  it("o pedido só vai para uma ponte do mesmo dono que anunciou o apelido", () => {
    const listeners = new Listeners();
    const ana = listener(1);
    const bia = listener(2);
    listeners.connect(ana.link, ["loja"]);
    listeners.connect(bia.link, ["loja", "site"]);
    const anaTab = requester(1);
    expect(listeners.request(anaTab.link, "r1", "loja")).toBeNull();
    expect(ana.sent).toEqual([{ reqId: "r1", alias: "loja" }]);
    expect(bia.sent).toEqual([]);
    expect(listeners.request(anaTab.link, "r2", "site")).toBe("unknown-alias");
    expect(listeners.request(requester(3).link, "r3", "loja")).toBe("no-listener");
    expect(bia.sent).toEqual([]);
  });

  it("a resposta só vale se vier da ponte que recebeu o pedido", () => {
    const listeners = new Listeners();
    const ana = listener(1);
    const other = listener(1);
    listeners.connect(ana.link, ["loja"]);
    listeners.connect(other.link, ["site"]);
    const tab = requester(1);
    listeners.request(tab.link, "r1", "loja");
    listeners.result(other.link, "r1", true);
    expect(tab.results).toEqual([]);
    listeners.result(listener(2).link, "r1", true);
    expect(tab.results).toEqual([]);
    listeners.result(ana.link, "r1", false, "folder-missing");
    expect(tab.results).toEqual([{ reqId: "r1", ok: false, error: "folder-missing" }]);
    listeners.result(ana.link, "r1", true); // já respondido
    expect(tab.results).toHaveLength(1);
  });

  it("sem resposta em 20 s vira timeout; ponte que cai responde no-listener; aba que fecha não recebe nada", () => {
    const listeners = new Listeners();
    const ana = listener(1);
    listeners.connect(ana.link, ["loja"]);
    const tab = requester(1);
    listeners.request(tab.link, "r1", "loja");
    vi.advanceTimersByTime(19_999);
    expect(tab.results).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tab.results).toEqual([{ reqId: "r1", ok: false, error: "timeout" }]);
    listeners.request(tab.link, "r2", "loja");
    listeners.disconnect(ana.link);
    expect(tab.results.at(-1)).toEqual({ reqId: "r2", ok: false, error: "no-listener" });
    const again = listener(1);
    listeners.connect(again.link, ["loja"]);
    const closing = requester(1);
    listeners.request(closing.link, "r3", "loja");
    listeners.forget(closing.link);
    vi.advanceTimersByTime(30_000);
    expect(closing.results).toEqual([]);
  });

  it("revogar o token derruba só as pontes dele, na hora", () => {
    const listeners = new Listeners();
    const old = listener(1, 7);
    const current = listener(1, 8);
    listeners.connect(old.link, ["loja"]);
    listeners.connect(current.link, ["site"]);
    listeners.closeForToken(7);
    expect(old.closed).toEqual([4001]);
    expect(current.closed).toEqual([]);
    expect(listeners.summary(1).aliases).toEqual(["site"]);
  });

  it("reqId repetido enquanto o primeiro espera é recusado", () => {
    const listeners = new Listeners();
    const ana = listener(1);
    listeners.connect(ana.link, ["loja"]);
    const tab = requester(1);
    expect(listeners.request(tab.link, "r1", "loja")).toBeNull();
    expect(listeners.request(tab.link, "r1", "loja")).toBe("spawn-failed");
    expect(ana.sent).toHaveLength(1);
  });
});
