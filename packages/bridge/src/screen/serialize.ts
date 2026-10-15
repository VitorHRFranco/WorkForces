import type { IBufferCell, IBufferLine } from "@xterm/headless";

export const MASK_CHAR = "•";

const NO_MASK: ReadonlySet<number> = new Set();

function colorCodes(cell: IBufferCell, target: "fg" | "bg"): string[] {
  const isRGB = target === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = target === "fg" ? cell.isFgPalette() : cell.isBgPalette();
  const color = target === "fg" ? cell.getFgColor() : cell.getBgColor();
  const base = target === "fg" ? 30 : 40;
  if (isRGB) return [`${base + 8};2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}`];
  if (isPalette) {
    if (color < 8) return [`${base + color}`];
    if (color < 16) return [`${base + 60 + color - 8}`];
    return [`${base + 8};5;${color}`];
  }
  return [];
}

/** Parâmetros SGR dos atributos da célula ("" = tudo padrão). */
export function sgrFor(cell: IBufferCell): string {
  const codes: string[] = [];
  if (cell.isBold()) codes.push("1");
  if (cell.isDim()) codes.push("2");
  if (cell.isItalic()) codes.push("3");
  if (cell.isUnderline()) codes.push("4");
  if (cell.isBlink()) codes.push("5");
  if (cell.isInverse()) codes.push("7");
  if (cell.isInvisible()) codes.push("8");
  if (cell.isStrikethrough()) codes.push("9");
  if (cell.isOverline()) codes.push("53");
  codes.push(...colorCodes(cell, "fg"), ...colorCodes(cell, "bg"));
  return codes.join(";");
}

/**
 * Serializa uma linha da tela a partir das células: texto + SGR, sem nenhuma outra
 * sequência de escape. Células em `masked` viram MASK_CHAR (caractere largo vira dois).
 * Espaços finais sem cor são cortados; a linha termina sem atributos ativos.
 */
export function serializeRow(line: IBufferLine | undefined, cols: number, masked: ReadonlySet<number> = NO_MASK): string {
  if (!line) return "";
  const width = Math.min(cols, line.length);
  let cell = line.getCell(0);
  if (!cell) return "";

  let last = -1;
  for (let x = 0; x < width; x++) {
    cell = line.getCell(x, cell) ?? cell;
    const chars = cell.getChars();
    if ((chars !== "" && chars !== " ") || !cell.isBgDefault() || cell.isInverse() || masked.has(x)) last = x;
  }

  let out = "";
  let current = "";
  for (let x = 0; x <= last; x++) {
    cell = line.getCell(x, cell) ?? cell;
    const cellWidth = cell.getWidth();
    if (cellWidth === 0) continue; // segunda metade de um caractere largo
    const sgr = sgrFor(cell);
    if (sgr !== current) {
      out += sgr === "" ? "\x1b[0m" : `\x1b[0;${sgr}m`;
      current = sgr;
    }
    out += masked.has(x) ? MASK_CHAR.repeat(cellWidth) : cell.getChars() || " ";
  }
  if (current !== "") out += "\x1b[0m";
  return out;
}
