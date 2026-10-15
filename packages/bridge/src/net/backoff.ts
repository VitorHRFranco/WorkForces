/** Espera antes da tentativa `attempt` (0, 1, 2…): de ~1 s até 30 s, com ±20% de variação. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return Math.min(30_000, Math.round(base * (0.8 + 0.4 * random())));
}
