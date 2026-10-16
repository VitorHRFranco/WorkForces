/** Conta falhas por chave dentro de uma janela de tempo. */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string): void {
    if (this.failures.size > 10_000) this.prune();
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((time) => time > cutoff);
  }

  private prune(): void {
    for (const key of this.failures.keys()) if (this.recent(key).length === 0) this.failures.delete(key);
  }
}
