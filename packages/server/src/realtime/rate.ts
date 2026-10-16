/** Janela fixa: no máximo `max` mensagens a cada `windowMs`. */
export class MessageRate {
  private windowStart = Number.NEGATIVE_INFINITY;
  private count = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  allow(): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.max;
  }
}
