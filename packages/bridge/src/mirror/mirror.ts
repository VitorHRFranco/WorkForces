import type { AgentState, AgentToServer } from "@workforces/protocol";
import type { MaskPattern } from "../masking/mask.js";
import { createHeadless, type Headless } from "../screen/headless.js";
import { takeSnapshot, type Snapshot } from "../screen/snapshot.js";
import { ActivityTracker } from "./activity.js";
import { FrameDiffer } from "./differ.js";

export type MirrorMessage = Extract<AgentToServer, { type: "frame" | "status" }>;

export interface MirrorOptions {
  cols: number;
  rows: number;
  patterns: readonly MaskPattern[];
  /** Envia ao servidor; devolve false se a mensagem foi descartada. */
  send: (message: MirrorMessage) => boolean;
  /** Envia ao painel do app pelo canal local; devolve false se a mensagem foi descartada. */
  local?: (message: MirrorMessage) => boolean;
  now?: () => number;
  tickMs?: number;
  /** Só tira o quadro depois de a saída do PTY ficar este tempo quieta… */
  settleMs?: number;
  /** …adiando no máximo este tempo. */
  maxDeferMs?: number;
  maxFrameBytes?: number;
  /** Chamada quando um tick falha; o tick nunca rejeita. */
  onError?: (error: unknown) => void;
}

/**
 * Caminho de espelhamento: recebe a saída do PTY, mantém a tela num headless e envia quadros
 * mascarados a duas saídas, cada uma com o seu gerador de quadros: o servidor, só enquanto há
 * visitantes, e o painel do app, só enquanto ele está aberto. Nunca toca no caminho rápido.
 */
export class Mirror {
  private readonly headless: Headless;
  private readonly differ: FrameDiffer;
  private readonly localDiffer: FrameDiffer;
  private readonly activity = new ActivityTracker();
  private readonly patterns: MaskPattern[];
  private readonly now: () => number;
  private readonly settleMs: number;
  private readonly maxDeferMs: number;
  private viewers = 0;
  private localWatching = false;
  private dirty = true;
  private ticking = false;
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private deferringSince: number | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: MirrorOptions) {
    this.headless = createHeadless(options.cols, options.rows);
    this.differ = new FrameDiffer(options.maxFrameBytes);
    this.localDiffer = new FrameDiffer(options.maxFrameBytes);
    this.patterns = [...options.patterns];
    this.now = options.now ?? (() => performance.now());
    this.settleMs = options.settleMs ?? 30;
    this.maxDeferMs = options.maxDeferMs ?? 500;
  }

  /** Saída do PTY. */
  write(data: string): void {
    const now = this.now();
    this.headless.write(data);
    this.activity.markChanged(now);
    this.lastWriteAt = now;
    this.dirty = true;
  }

  resize(cols: number, rows: number): void {
    this.headless.resize(cols, rows);
    this.dirty = true;
  }

  setViewers(n: number): void {
    if (n > 0 && this.viewers === 0) {
      this.differ.reset();
      this.dirty = true;
    }
    this.viewers = n;
  }

  /** O painel do app abriu ou fechou neste agente; ao abrir, o próximo quadro é um quadro-chave. */
  setLocalWatching(on: boolean): void {
    if (on) {
      this.localDiffer.reset();
      this.dirty = true;
    }
    this.localWatching = on;
  }

  /** Padrões de máscara que chegaram depois (os extras do app); valem a partir da próxima foto. */
  addPatterns(patterns: readonly MaskPattern[]): void {
    this.patterns.push(...patterns);
    this.dirty = true;
  }

  get state(): AgentState {
    return this.activity.state;
  }

  /** A conexão foi (re)aberta: o servidor não sabe nada desta tela até pedir de novo. */
  connectionOpened(): void {
    this.viewers = 0;
    this.differ.reset();
    this.options.send({ type: "status", state: this.activity.state });
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.now();
      const state = this.activity.poll(now);
      if (state) {
        this.options.send({ type: "status", state });
        this.options.local?.({ type: "status", state });
      }
      if (!this.watched() || !this.dirty) return;
      const settling = now - this.lastWriteAt < this.settleMs;
      if (settling) {
        this.deferringSince ??= now;
        if (now - this.deferringSince < this.maxDeferMs) return;
      }
      this.deferringSince = null;
      this.dirty = false;
      await this.headless.flush();
      if (this.stopped || !this.watched()) return;
      const snapshot = takeSnapshot(this.headless.term, this.patterns, this.headless.isCursorVisible());
      if (this.viewers > 0) this.emit(this.differ, snapshot, this.options.send);
      if (this.localWatching && this.options.local) this.emit(this.localDiffer, snapshot, this.options.local);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.ticking = false;
    }
  }

  /** Alguém olha a tela: visitantes no servidor ou o painel do app. */
  private watched(): boolean {
    return this.viewers > 0 || (this.localWatching && this.options.local !== undefined);
  }

  /** Manda os quadros a uma saída; se ela recusar, a próxima foto vai como quadro-chave. */
  private emit(differ: FrameDiffer, snapshot: Snapshot, send: (message: MirrorMessage) => boolean): void {
    for (const frame of differ.next(snapshot)) {
      if (!send({ type: "frame", ...frame })) {
        differ.reset();
        this.dirty = true;
        return;
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.tickMs ?? 100);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.headless.dispose();
  }
}
