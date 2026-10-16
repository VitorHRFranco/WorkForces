export interface MaskPattern {
  readonly name: string;
  /** Sempre com as flags "g" e "d". */
  readonly regex: RegExp;
  /** Se definido, só esse grupo é mascarado; senão, o trecho inteiro. */
  readonly group?: number;
}

export type Range = readonly [start: number, end: number];

export function findMaskRanges(text: string, patterns: readonly MaskPattern[]): Range[] {
  const found: [number, number][] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const span: readonly number[] | undefined =
        pattern.group === undefined ? [match.index, match.index + match[0].length] : match.indices?.[pattern.group];
      if (span && span[1]! > span[0]!) found.push([span[0]!, span[1]!]);
    }
  }
  return mergeRanges(found);
}

export function mergeRanges(ranges: [number, number][]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Compila os padrões extras do config local; os inválidos geram aviso e são ignorados. */
export function compileExtraPatterns(sources: readonly string[], warn: (message: string) => void): MaskPattern[] {
  const patterns: MaskPattern[] = [];
  for (const source of sources) {
    try {
      patterns.push({ name: `extra:${source}`, regex: new RegExp(source, "gd") });
    } catch (err) {
      warn(`padrão de segredo inválido ignorado: ${source} (${(err as Error).message})`);
    }
  }
  return patterns;
}
