import type { FrameBody } from "@workforces/protocol";
import xtermHeadless from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { applyFrame, type FrameState } from "../src/terminal/apply-frame";

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
    const state: FrameState = { lastSeq: null };
    expect(applyFrame(term, frame(1, true, [[0, "\x1b[1;32mOLÁ\x1b[0m"], [1, "linha 2"], [2, ""]]), state)).toBe("ok");
    expect(applyFrame(term, frame(2, false, [[1, "nova"]], { cursor: { x: 3, y: 2, visible: false } }), state)).toBe("ok");
    expect(await textOf(term)).toEqual(["OLÁ", "nova", ""]);
    expect([term.buffer.active.cursorX, term.buffer.active.cursorY]).toEqual([3, 2]);
    expect(state.lastSeq).toBe(2);
  });

  it("diff fora de sequência pede ressincronização sem escrever", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null };
    expect(applyFrame(term, frame(5, false, [[0, "x"]]), state)).toBe("gap");
    applyFrame(term, frame(1, true, [[0, "a"], [1, ""], [2, ""]]), state);
    expect(applyFrame(term, frame(3, false, [[0, "pulou"]]), state)).toBe("gap");
    expect(await textOf(term)).toEqual(["a", "", ""]);
    expect(state.lastSeq).toBe(1);
  });

  it("quadro-chave com outro tamanho redimensiona e não deixa sobra da tela antiga", async () => {
    const term = screen();
    const state: FrameState = { lastSeq: null };
    applyFrame(term, frame(1, true, [[0, "antiga"], [1, "tela"], [2, "aqui"]]), state);
    applyFrame(term, frame(2, true, [[0, "nova"], [1, ""]], { cols: 8, rows: 2 }), state);
    expect([term.cols, term.rows]).toEqual([8, 2]);
    expect(await textOf(term)).toEqual(["nova", ""]);
  });
});
