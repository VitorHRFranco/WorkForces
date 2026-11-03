const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Corta a digitação em pedaços de no máximo `max` unidades UTF-16, na ordem, sem partir um par substituto (um emoji fica
 * inteiro num pedaço só). O xterm entrega uma colagem inteira de uma vez, e o canal local recusa mensagens maiores que
 * `LOCAL_INPUT_MAX`.
 */
export function chunkInput(data: string, max: number): string[] {
  if (!Number.isInteger(max) || max < 2) throw new RangeError(`tamanho de pedaço inválido: ${max}`);
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + max, data.length);
    // O corte cairia entre as duas metades de um par: a metade alta passa para o pedaço seguinte.
    if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1)) && isLowSurrogate(data.charCodeAt(end))) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}
