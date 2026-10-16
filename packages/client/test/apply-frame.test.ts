import type { FrameBody } from "@workforces/protocol";
import xtermHeadless from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { RESYNC_RETRY_MS, applyFrame, sanitizeLine, type FrameState } from "../src/terminal/apply-frame";

const { Terminal } = xtermHeadless;
type Term = InstanceType<typeof Terminal>;

const screen = (): Term => new Terminal({ cols: 10, rows: 3, allowProposedApi: true });

async function textOf(term: Term): Promise<string[]> {
  await new Promise<void>((resolve) => term.write("", resolve));
  const buffer = term.buffer.active;
  return Array.from({ length: term.rows }, (_, y) => buffer.getLine(buffer.viewportY + y)!.translateToString(true));
}

const frame = (seq: number, key: boolean, lines: [number, string][], extra: Partial<FrameBody> = {}): FrameBody => ({
  seq,
  key,
  cols: 10,
  rows: 3,
  cursor: { x: 0, y: 0, visible: true },
  lines,
  ...extra,
});

describe("applyFrame", () => {
  it("quadro-chave desenha a tela e diffs mudam só as linhas enviadas", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    expect(applyFrame(term, frame(1, true, [[0, "\x1b[1;32mOLÁ\x1b[0m"], [1, "linha 2"], [2, ""]]), state)).toBe("ok");
    expect(applyFrame(term, frame(2, false, [[1, "nova"]], { cursor: { x: 3, y: 2, visible: false } }), state)).toBe("ok");
    expect(await textOf(term)).toEqual(["OLÁ", "nova", ""]);
    expect([term.buffer.active.cursorX, term.buffer.active.cursorY]).toEqual([3, 2]);
    expect(state.lastSeq).toBe(2);
  });

  it("diff fora de sequência pede ressincronização sem escrever", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    expect(applyFrame(term, frame(5, false, [[0, "x"]]), state, 1000)).toBe("gap");
    applyFrame(term, frame(1, true, [[0, "a"], [1, ""], [2, ""]]), state, 1050);
    expect(applyFrame(term, frame(3, false, [[0, "pulou"]]), state, 1000 + RESYNC_RETRY_MS)).toBe("gap");
    expect(await textOf(term)).toEqual(["a", "", ""]);
    expect(state.lastSeq).toBe(1);
  });

  it("quadro-chave com outro tamanho redimensiona e não deixa sobra da tela antiga", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    applyFrame(term, frame(1, true, [[0, "antiga"], [1, "tela"], [2, "aqui"]]), state);
    applyFrame(term, frame(2, true, [[0, "nova"], [1, ""]], { cols: 8, rows: 2 }), state);
    expect([term.cols, term.rows]).toEqual([8, 2]);
    expect(await textOf(term)).toEqual(["nova", ""]);
  });

  it("texto da ponte não sai da linha nem trava", async () => {
    const term = new Terminal({ cols: 40, rows: 3, allowProposedApi: true });
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    const lines: [number, string][] = [
      [0, "a\x1b[2147483647b"],
      [1, "x\x1b[2J\ny"],
      [2, "\x1b]8;;https://mal/\x07link\x1b]8;;\x07"],
    ];
    expect(applyFrame(term, frame(1, true, lines, { cols: 40, rows: 3 }), state)).toBe("ok");
    expect(await textOf(term)).toEqual(["a[2147483647b", "x[2Jy", "]8;;https://mal/link]8;;"]);
    expect(sanitizeLine("\x1b[1;32mOLÁ\x1b[0m")).toBe("\x1b[1;32mOLÁ\x1b[0m");
    expect(sanitizeLine("a\x9b2Jb")).toBe("a2Jb");
  });

  it("vários diffs fora de sequência pedem a tela uma vez só", () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    expect(applyFrame(term, frame(5, false, []), state, 1000)).toBe("gap");
    expect(applyFrame(term, frame(6, false, []), state, 1100)).toBe("waiting");
    expect(applyFrame(term, frame(7, false, []), state, 1200)).toBe("waiting");
    expect(applyFrame(term, frame(8, false, []), state, 1000 + RESYNC_RETRY_MS)).toBe("gap");
    expect(applyFrame(term, frame(9, true, [[0, "a"]]), state)).toBe("ok");
  });

  it("o quadro-chave da resposta não libera outro pedido antes de 3 s", () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    expect(applyFrame(term, frame(5, false, []), state, 1000)).toBe("gap");
    expect(applyFrame(term, frame(5, true, [[0, "a"]]), state, 1050)).toBe("ok");
    expect(applyFrame(term, frame(7, false, []), state, 1100)).toBe("waiting");
    expect(applyFrame(term, frame(9, false, []), state, 1000 + RESYNC_RETRY_MS)).toBe("gap");
  });

  it("linha mais larga que as colunas não quebra nem rola a tela", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null, lastResyncAt: null };
    applyFrame(term, frame(1, true, [[0, "r0"], [1, "r1"], [2, "r2"]]), state);
    applyFrame(term, frame(2, false, [[2, "0123456789ABCDE"]]), state);
    const lines = await textOf(term);
    expect(lines[0]).toBe("r0");
    expect(lines[1]).toBe("r1");
    expect(lines[2]!.startsWith("012345678")).toBe(true);
  });
});
