/** Conta tentativas por chave dentro de uma janela de tempo. */
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Registra uma tentativa; devolve false (sem registrar) se a chave já atingiu o limite. */
  tryAcquire(key: string): boolean {
    const recent = this.recent(key);
    if (recent.length >= this.max) return false;
    if (this.attempts.size > 10_000) this.prune();
    this.attempts.set(key, [...recent, this.now()]);
    return true;
  }

  /** Desfaz a tentativa mais recente (ex.: login certo não conta contra o IP). */
  release(key: string): void {
    const recent = this.recent(key);
    recent.pop();
    if (recent.length === 0) this.attempts.delete(key);
    else this.attempts.set(key, recent);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    return (this.attempts.get(key) ?? []).filter((time) => time > cutoff);
  }

  private prune(): void {
    for (const key of this.attempts.keys()) if (this.recent(key).length === 0) this.attempts.delete(key);
  }
}
