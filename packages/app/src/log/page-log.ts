export interface PageLogGateOptions {
  /** Quantos textos cabem na janela de tempo. */
  max?: number;
  windowMs?: number;
  /** O texto que passa disso é cortado. */
  maxChars?: number;
  now?: () => number;
}

/**
 * O portão dos erros que a página manda ao log: uma página em laço de erro não enche o disco. Aceita até `max` textos em
 * qualquer janela de `windowMs` e corta cada um em `maxChars`; o que não for texto é recusado.
 */
export class PageLogGate {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxChars: number;
  private readonly now: () => number;
  private readonly accepted: number[] = [];

  constructor(options: PageLogGateOptions = {}) {
    this.max = options.max ?? 50;
    this.windowMs = options.windowMs ?? 10_000;
    this.maxChars = options.maxChars ?? 2_000;
    this.now = options.now ?? (() => Date.now());
  }

  /** O texto (cortado) se couber no limite; senão, null. */
  accept(text: unknown): string | null {
    if (typeof text !== "string") return null;
    const now = this.now();
    while (this.accepted.length > 0 && now - this.accepted[0]! >= this.windowMs) this.accepted.shift();
    if (this.accepted.length >= this.max) return null;
    this.accepted.push(now);
    return text.length > this.maxChars ? text.slice(0, this.maxChars) : text;
  }
}
