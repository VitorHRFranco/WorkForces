import type { AgentState } from "@workforces/protocol";

/** "working" enquanto o PTY produziu saída na janela recente; "idle" depois. */
export class ActivityTracker {
  private lastChange = Number.NEGATIVE_INFINITY;
  private current: AgentState = "idle";

  constructor(private readonly windowMs = 3000) {}

  get state(): AgentState {
    return this.current;
  }

  markChanged(now: number): void {
    this.lastChange = now;
  }

  /** Devolve o novo estado se ele mudou desde a última chamada; senão, null. */
  poll(now: number): AgentState | null {
    const next: AgentState = now - this.lastChange < this.windowMs ? "working" : "idle";
    if (next === this.current) return null;
    this.current = next;
    return next;
  }
}
