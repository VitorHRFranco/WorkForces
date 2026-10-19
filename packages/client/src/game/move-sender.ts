import type { Direction } from "@workforces/protocol";

export interface MoveState {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

export const MOVE_INTERVAL_MS = 100;

const same = (a: MoveState | null, b: MoveState) => a !== null && a.x === b.x && a.y === b.y && a.dir === b.dir && a.moving === b.moving;

/** Manda `move` no máximo a cada 100 ms enquanto anda, e uma vez ao parar (spec 8). */
export class MoveSender {
  private current: MoveState | null = null;
  private sent: MoveState | null = null;
  private sentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (state: MoveState) => boolean | void,
    private readonly now: () => number,
  ) {}

  update(state: MoveState): void {
    this.current = state;
    if (same(this.sent, state)) return;
    const stopped = this.sent?.moving === true && !state.moving;
    if (stopped || this.now() - this.sentAt >= MOVE_INTERVAL_MS) this.flush();
  }

  /** Manda já a posição atual, se ela ainda não foi mandada (ex.: antes de pedir para assistir um agente). */
  flush(): void {
    if (this.current === null || same(this.sent, this.current)) return;
    this.push(this.current);
  }

  /** Repete a posição atual mesmo que já tenha sido mandada (ex.: depois de reconectar, o servidor não sabe onde estamos). */
  resend(): void {
    if (this.current !== null) this.push(this.current);
  }

  private push(state: MoveState): void {
    // false = a conexão descartou (limite por segundo): continua pendente.
    if (this.send(state) === false) return;
    this.sent = state;
    this.sentAt = this.now();
  }
}
