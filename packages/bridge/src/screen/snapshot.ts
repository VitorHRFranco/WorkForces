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

/** Quantas linhas acima da tela o mascaramento analisa (histórico nunca é enviado). */
export const LOOKBACK_ROWS = 100;

/** Espaço, desenho de caixa (U+2500–U+257F) ou barra vertical. */
const BORDER = /[\s\u2500-\u257F|]/;
const KEY_MARKER = /-----(BEGIN|END) [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;

type LineAt = (row: number) => IBufferLine | undefined;

interface CellRef {
  row: number;
  col: number;
  width: number;
}

interface KeyMarker {
  kind: "BEGIN" | "END";
  row: number;
  endRow: number;
}

export function takeSnapshot(term: Terminal, patterns: readonly MaskPattern[], cursorVisible: boolean): Snapshot {
  const cols = Math.min(term.cols, LIMITS.maxCols);
  const rows = Math.min(term.rows, LIMITS.maxRows);
  const buffer = term.buffer.active;
  const above = Math.min(LOOKBACK_ROWS, buffer.viewportY);
  const total = above + rows;
  const first = buffer.viewportY - above;
  // Índice de janela: 0 … above+rows-1 (linhas acima da tela + linhas visíveis).
  const lineAt: LineAt = (w) => buffer.getLine(first + w);
  const masked = Array.from({ length: total }, () => new Set<number>());

  // 1. Padrões sobre linhas lógicas: linhas quebradas pelo terminal são unidas.
  forEachLogicalLine(lineAt, total, (start, end) => maskLogicalLine(lineAt, start, end, cols, patterns, masked));

  // 2. Blocos de chave privada, detectados sobre as linhas lógicas.
  applyKeyMarkers(collectKeyMarkers(lineAt, total, cols), cols, masked);

  // 3. Continuação: segredo que encosta na borda direita segue na linha de baixo.
  for (let row = 0; row + 1 < total; row++) {
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
    lines: Array.from({ length: rows }, (_, row) => serializeRow(lineAt(above + row), cols, masked[above + row])),
  };
}

function forEachLogicalLine(lineAt: LineAt, total: number, fn: (start: number, end: number) => void): void {
  let start = 0;
  while (start < total) {
    let end = start + 1;
    while (end < total && lineAt(end)?.isWrapped) end++;
    fn(start, end);
    start = end;
  }
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

/** Marcadores BEGIN/END de chave privada, em ordem, com a linha em que começam e terminam. */
function collectKeyMarkers(lineAt: LineAt, total: number, cols: number): KeyMarker[] {
  const markers: KeyMarker[] = [];
  forEachLogicalLine(lineAt, total, (start, end) => {
    let text = "";
    const rowOfIndex: number[] = [];
    for (let row = start; row < end; row++) {
      const part = lineAt(row)?.translateToString(false, 0, cols) ?? "";
      for (let i = 0; i < part.length; i++) rowOfIndex.push(row);
      text += part;
    }
    for (const match of text.matchAll(KEY_MARKER)) {
      markers.push({
        kind: match[1] as "BEGIN" | "END",
        row: rowOfIndex[match.index]!,
        endRow: rowOfIndex[match.index + match[0].length - 1]!,
      });
    }
  });
  return markers;
}

/** BEGIN abre o bloco; END fecha. END sem BEGIN mascara desde o início da janela. */
function applyKeyMarkers(markers: readonly KeyMarker[], cols: number, masked: Set<number>[]): void {
  const maskRow = (row: number): void => {
    for (let col = 0; col < cols; col++) masked[row]!.add(col);
  };
  let inKey = false;
  let next = 0;
  for (let row = 0; row < masked.length; row++) {
    if (inKey) maskRow(row);
    while (next < markers.length && markers[next]!.row === row) {
      const marker = markers[next++]!;
      if (marker.kind === "BEGIN") {
        inKey = true;
      } else {
        // END: sem BEGIN aberto, o bloco começou acima da janela.
        const from = inKey ? row : 0;
        for (let r = from; r <= marker.endRow; r++) maskRow(r);
        inKey = false;
      }
      for (let r = row; r <= marker.endRow; r++) maskRow(r);
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
