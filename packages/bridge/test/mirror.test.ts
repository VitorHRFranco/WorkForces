import type { AgentFrame } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { BUILTIN_PATTERNS } from "../src/masking/patterns.js";
import { Mirror, type MirrorMessage, type MirrorOptions } from "../src/mirror/mirror.js";
import { stripAnsi } from "./helpers/ansi.js";

function setup(extra: Partial<MirrorOptions> = {}) {
  const sent: MirrorMessage[] = [];
  let clock = 10_000;
  let accept = true;
  const mirror = new Mirror({
    cols: 40,
    rows: 5,
    patterns: BUILTIN_PATTERNS,
    send: (message) => {
      if (!accept) return false;
      sent.push(message);
      return true;
    },
    now: () => clock,
    settleMs: 0,
    ...extra,
  });
  return {
    mirror,
    sent,
    frames: () => sent.filter((m): m is AgentFrame => m.type === "frame"),
    statuses: () => sent.filter((m) => m.type === "status"),
    advance: (ms: number) => {
      clock += ms;
    },
    rejectNextSends: (value: boolean) => {
      accept = !value;
    },
  };
}

describe("Mirror", () => {
  it("sem visitantes não envia quadros, mas envia o status", async () => {
    const t = setup();
    t.mirror.write("oi");
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(0);
    expect(t.statuses()).toEqual([{ type: "status", state: "working" }]);
  });

  it("o primeiro visitante recebe quadro-chave mascarado", async () => {
    const t = setup();
    t.mirror.write("senha=abcd1234\r\n");
    t.mirror.setViewers(1);
    await t.mirror.tick();
    const [frame] = t.frames();
    expect(frame?.key).toBe(true);
    expect(frame?.lines).toHaveLength(5);
    expect(stripAnsi(frame!.lines[0]![1])).toBe("senha=" + "•".repeat(8));
  });

  it("depois envia só as linhas que mudaram", async () => {
    const t = setup();
    t.mirror.setViewers(1);
    await t.mirror.tick();
    t.mirror.write("\x1b[3;1Hnovo");
    await t.mirror.tick();
    const last = t.frames().at(-1)!;
    expect(last.key).toBe(false);
    expect(last.lines.map(([row, text]) => [row, stripAnsi(text)])).toEqual([[2, "novo"]]);
  });

  it("agrupa várias escritas num quadro só e não repete quadro sem mudança", async () => {
    const t = setup();
    t.mirror.setViewers(1);
    t.mirror.write("a");
    t.mirror.write("b");
    await t.mirror.tick();
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(1);
  });

  it("envio recusado faz o próximo quadro ser quadro-chave", async () => {
    const t = setup();
    t.mirror.setViewers(1);
    await t.mirror.tick();
    t.rejectNextSends(true);
    t.mirror.write("x");
    await t.mirror.tick();
    t.rejectNextSends(false);
    t.mirror.write("y");
    await t.mirror.tick();
    expect(t.frames().at(-1)!.key).toBe(true);
  });

  it("redimensionar enquanto alguém assiste gera quadro-chave com o novo tamanho", async () => {
    const t = setup();
    t.mirror.setViewers(1);
    t.mirror.write("antes");
    await t.mirror.tick();
    t.mirror.resize(30, 4);
    await t.mirror.tick();
    const last = t.frames().at(-1)!;
    expect(last).toMatchObject({ key: true, cols: 30, rows: 4 });
    expect(last.lines).toHaveLength(4);
  });

  it("connectionOpened reenvia o status e exige novo pedido de visitantes", async () => {
    const t = setup();
    t.mirror.setViewers(1);
    await t.mirror.tick();
    t.mirror.connectionOpened();
    expect(t.statuses().at(-1)).toEqual({ type: "status", state: "idle" });
    t.mirror.write("z");
    const before = t.frames().length;
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(before);
    t.mirror.setViewers(1);
    await t.mirror.tick();
    expect(t.frames().at(-1)!.key).toBe(true);
  });

  it("espera a saída do PTY assentar, mas não para sempre", async () => {
    const t = setup({ settleMs: 30, maxDeferMs: 500 });
    t.mirror.setViewers(1);
    t.mirror.write("a");
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(0);
    t.advance(40);
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(1);

    let forcedAt = -1;
    for (let i = 0; i < 60; i++) {
      t.advance(10);
      t.mirror.write(String(i % 10));
      await t.mirror.tick();
      if (forcedAt < 0 && t.frames().length === 2) forcedAt = i;
    }
    expect(forcedAt).toBe(50);
  });

  it("a primeira rajada depois de um período quieto também espera assentar", async () => {
    const t = setup({ settleMs: 30, maxDeferMs: 500 });
    t.mirror.setViewers(1);
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(1);
    t.advance(1000);
    t.mirror.write("x");
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(1);
    t.advance(40);
    await t.mirror.tick();
    expect(t.frames()).toHaveLength(2);
  });

  it("erro num tick vai para onError e não rejeita", async () => {
    const errors: unknown[] = [];
    const t = setup({
      onError: (error) => errors.push(error),
      send: (message) => {
        if (message.type === "frame") throw new Error("falhou");
        return true;
      },
    });
    t.mirror.setViewers(1);
    t.mirror.write("a");
    await expect(t.mirror.tick()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("falhou");
  });

  it("stop durante um tick em andamento não envia nada nem lança", async () => {
    const errors: unknown[] = [];
    const t = setup({ onError: (error) => errors.push(error) });
    t.mirror.setViewers(1);
    t.mirror.write("a");
    const pending = t.mirror.tick();
    t.mirror.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(t.frames()).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expect(t.mirror.tick()).resolves.toBeUndefined();
    expect(t.frames()).toHaveLength(0);
    void pending;
  });
});
