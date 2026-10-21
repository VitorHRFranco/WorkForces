import type { Point, Rect, Seat } from "@workforces/protocol";
import { feetBlocked } from "./props";

/** Até quantos px dos pés um assento "puxa" quem para perto dele. */
export const SIT_RADIUS = 14;
/** Quanto tempo parado perto de um assento até sentar. */
export const SIT_DELAY_MS = 400;

/** Assento livre mais perto dentro do raio. Um assento com alguém parado no ponto exato dele está ocupado. */
export function nearestSeat(seats: readonly Seat[], at: Point, taken: readonly Point[] = [], radius = SIT_RADIUS): Seat | null {
  let best: Seat | null = null;
  let bestDistance = radius;
  for (const seat of seats) {
    if (taken.some((point) => point.x === seat.x && point.y === seat.y)) continue;
    const distance = Math.hypot(seat.x - at.x, seat.y - at.y);
    if (distance <= bestDistance) {
      best = seat;
      bestDistance = distance;
    }
  }
  return best;
}

/** Quem senta vai para o ponto exato do assento: é assim que os outros sabem que a pessoa está sentada. */
export function seatAt(seats: readonly Seat[], at: Point): Seat | null {
  return seats.find((seat) => seat.x === at.x && seat.y === at.y) ?? null;
}

/** A um passo do assento, em ordem de preferência: abaixo, acima, à direita e à esquerda. */
const STAND_OFFSETS = [
  [0, 12],
  [0, -12],
  [12, 0],
  [-12, 0],
] as const;

/**
 * Onde ficar em pé quem voltou exatamente no ponto de um assento (recarregou a página sentado).
 * Fora do ponto, para ninguém aparecer sentado no lugar de outra pessoa; perto o bastante para sentar de novo;
 * com os pés fora dos móveis. As paredes ficam com a física.
 */
export function standSpot(seat: Point, solids: readonly Rect[]): Point {
  for (const [dx, dy] of STAND_OFFSETS) {
    const at = { x: seat.x + dx, y: seat.y + dy };
    if (!feetBlocked(at, solids)) return at;
  }
  return { x: seat.x, y: seat.y };
}
