/** Uma tentativa de abrir agente a cada 5 s (spec 5.8). */
export const SPAWN_INTERVAL_MS = 5_000;
/** No máximo 5 agentes abertos neste computador (spec 5.8). */
export const MAX_OPEN_AGENTS = 5;

/** Limite de frequência da própria ponte: vale mesmo se o servidor for mal-intencionado. */
export class SpawnLimits {
  private last = Number.NEGATIVE_INFINITY;

  /** Gasta a vez se já passou o intervalo; false = cedo demais. Toda tentativa conta, dando certo ou não. */
  take(now: number): boolean {
    if (now - this.last < SPAWN_INTERVAL_MS) return false;
    this.last = now;
    return true;
  }
}
