import type { IBufferCell } from "@xterm/headless";
import { isSafeLine } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { createHeadless } from "../src/screen/headless.js";
import { serializeRow } from "../src/screen/serialize.js";
import { stripAnsi } from "./helpers/ansi.js";

async function screen(cols: number, data: string) {
  const headless = createHeadless(cols, 2);
  headless.write(data);
  await headless.flush();
  return headless;
}

function describeCell(cell: IBufferCell) {
  return {
    chars: cell.getChars(),
    width: cell.getWidth(),
    bold: cell.isBold() !== 0,
    underline: cell.isUnderline() !== 0,
    fgRGB: cell.isFgRGB(),
    fgPalette: cell.isFgPalette(),
    fg: cell.getFgColor(),
    bgRGB: cell.isBgRGB(),
    bgPalette: cell.isBgPalette(),
    bg: cell.getBgColor(),
  };
}

describe("serializeRow", () => {
  it("reproduz texto, cores e estilos (ida e volta)", async () => {
    const source = await screen(20, "\x1b[1;31mAB\x1b[0m \x1b[38;2;1;2;3;48;5;200mC\x1b[0m界\x1b[92;4mD");
    const line = serializeRow(source.term.buffer.active.getLine(0), 20);
    const copy = await screen(20, "\x1b[H" + line);
    for (let x = 0; x < 8; x++) {
      const a = source.term.buffer.active.getLine(0)!.getCell(x)!;
      const b = copy.term.buffer.active.getLine(0)!.getCell(x)!;
      expect(describeCell(b), `coluna ${x}`).toEqual(describeCell(a));
    }
    expect(line.endsWith("\x1b[0m")).toBe(true);
  });

  it("só emite texto e SGR que o protocolo aceita, mesmo com entrada hostil", async () => {
    const source = await screen(
      40,
      "\x1b[1;31mcor\x1b[0m \x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b[?7h\x9b2J\x1b[2b a\rb\x7f\x00\x1b(0q\x1b[38;2;1;2;3;48;5;200mZ\x1b[4:3mw",
    );
    for (let y = 0; y < 2; y++) {
      const line = serializeRow(source.term.buffer.active.getLine(y), 40);
      expect(isSafeLine(line), JSON.stringify(line)).toBe(true);
    }
  });

  it("troca células mascaradas por • mantendo a largura", async () => {
    const source = await screen(20, "AB C界D");
    const line = serializeRow(source.term.buffer.active.getLine(0), 20, new Set([0, 4, 5]));
    expect(stripAnsi(line)).toBe("•B C••D");
  });

  it("corta espaços finais sem cor, mas mantém fundo colorido", async () => {
    const plain = await screen(20, "abc   ");
    expect(serializeRow(plain.term.buffer.active.getLine(0), 20)).toBe("abc");
    const colored = await screen(20, "abc\x1b[44m  \x1b[0m");
    expect(stripAnsi(serializeRow(colored.term.buffer.active.getLine(0), 20))).toBe("abc  ");
  });

  it("não deixa passar título, OSC 52 nem hyperlink", async () => {
    const source = await screen(40, "\x1b]0;titulo\x07\x1b]52;c;ZGFkb3M=\x07\x1b]8;;https://exemplo\x07link\x1b]8;;\x07ok");
    const line = serializeRow(source.term.buffer.active.getLine(0), 40);
    expect(line).not.toContain("\x1b]");
    expect(stripAnsi(line)).toBe("linkok");
  });

  it("linha inexistente ou vazia vira texto vazio", async () => {
    const empty = await screen(20, "");
    expect(serializeRow(empty.term.buffer.active.getLine(0), 20)).toBe("");
    expect(serializeRow(undefined, 20)).toBe("");
  });
});

describe("createHeadless", () => {
  it("acompanha a visibilidade do cursor e usa larguras Unicode 11", async () => {
    const headless = await screen(10, "\x1b[?25l😀");
    expect(headless.isCursorVisible()).toBe(false);
    expect(headless.term.buffer.active.getLine(0)!.getCell(0)!.getWidth()).toBe(2);
    headless.write("\x1b[?25h");
    await headless.flush();
    expect(headless.isCursorVisible()).toBe(true);
  });
});
