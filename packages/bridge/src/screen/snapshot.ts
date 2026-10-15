import type { IBufferLine, Terminal } from "@xterm/headless";
import { LIMITS } from "@workforces/protocol";
import { findMaskRanges, type MaskPattern } from "../masking/mask.js";
import { serializeRow } from "./serialize.js";

export interface Snapshot {
  cols: number;
  rows: number;
  cursor: { x: number; y: number; visible: boolean };
  lines: string[];
}

/** Distância máxima da borda direita para continuar a máscara na linha seguinte. */
export const CONTINUATION_MARGIN = 4;

/** Espaço, desenho de caixa (U+2500–U+257F) ou barra vertical. */
const BORDER = /[\s\u2500-\u257F|]/;
const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

type LineAt = (row: number) => IBufferLine | undefined;

interface CellRef {
  row: number;
  col: number;
  width: number;
}

export function takeSnapshot(term: Terminal, patterns: readonly MaskPattern[], cursorVisible: boolean): Snapshot {
  const cols = Math.min(term.cols, LIMITS.maxCols);
  const rows = Math.min(term.rows, LIMITS.maxRows);
  const buffer = term.buffer.active;
  const top = buffer.viewportY;
  const lineAt: LineAt = (row) => buffer.getLine(top + row);
  const masked = Array.from({ length: rows }, () => new Set<number>());

  // 1. Padrões sobre linhas lógicas: linhas quebradas pelo terminal são unidas.
  let start = 0;
  while (start < rows) {
    let end = start + 1;
    while (end < rows && lineAt(end)?.isWrapped) end++;
    maskLogicalLine(lineAt, start, end, cols, patterns, masked);
    start = end;
  }

  // 2. Bloco de chave privada: da linha BEGIN até a linha END (ou o fim da tela).
  let inKey = false;
  for (let row = 0; row < rows; row++) {
    const text = lineAt(row)?.translateToString(true, 0, cols) ?? "";
    if (KEY_BEGIN.test(text)) inKey = true;
    if (inKey) for (let col = 0; col < cols; col++) masked[row]!.add(col);
    if (KEY_END.test(text)) inKey = false;
  }

  // 3. Continuação: segredo que encosta na borda direita segue na linha de baixo.
  for (let row = 0; row + 1 < rows; row++) {
    const lastContent = lastContentCol(lineAt(row), cols);
    if (lastContent >= cols - CONTINUATION_MARGIN && masked[row]!.has(lastContent)) {
      maskFirstRun(lineAt(row + 1), cols, masked[row + 1]!);
    }
  }

  return {
    cols,
    rows,
    cursor: {
      x: Math.min(buffer.cursorX, cols - 1),
      y: Math.min(buffer.cursorY, rows - 1),
      visible: cursorVisible,
    },
    lines: Array.from({ length: rows }, (_, row) => serializeRow(lineAt(row), cols, masked[row])),
  };
}

function maskLogicalLine(
  lineAt: LineAt,
  start: number,
  end: number,
  cols: number,
  patterns: readonly MaskPattern[],
  masked: Set<number>[],
): void {
  let text = "";
  const refs: CellRef[] = []; // refs[i] = célula de onde veio o code unit i de `text`
  for (let row = start; row < end; row++) {
    const line = lineAt(row);
    if (!line) continue;
    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col);
      if (!cell) break;
      const width = cell.getWidth();
      if (width === 0) continue;
      const chars = cell.getChars() || " ";
      for (let i = 0; i < chars.length; i++) refs.push({ row, col, width });
      text += chars;
    }
  }
  for (const [from, to] of findMaskRanges(text, patterns)) {
    for (let i = from; i < to; i++) {
      const ref = refs[i]!;
      for (let w = 0; w < ref.width; w++) masked[ref.row]!.add(ref.col + w);
    }
  }
}

function lastContentCol(line: IBufferLine | undefined, cols: number): number {
  if (!line) return -1;
  for (let col = cols - 1; col >= 0; col--) {
    const chars = line.getCell(col)?.getChars() ?? "";
    if (chars !== "" && !BORDER.test(chars)) return col;
  }
  return -1;
}

function maskFirstRun(line: IBufferLine | undefined, cols: number, target: Set<number>): void {
  if (!line) return;
  let col = 0;
  while (col < cols) {
    const chars = line.getCell(col)?.getChars() ?? "";
    if (chars !== "" && !BORDER.test(chars)) break;
    col++;
  }
  while (col < cols) {
    const cell = line.getCell(col);
    if (!cell) break;
    const chars = cell.getChars();
    if (cell.getWidth() !== 0 && (chars === "" || BORDER.test(chars))) break;
    target.add(col);
    col++;
  }
}
