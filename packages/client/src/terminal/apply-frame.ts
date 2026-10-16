import type { FrameBody } from "@workforces/protocol";

export interface FrameTarget {
  readonly cols: number;
  readonly rows: number;
  resize(cols: number, rows: number): void;
  write(data: string): void;
}

export const RESYNC_RETRY_MS = 3_000;

export interface FrameState {
  lastSeq: number | null;
  /** Quando a tela inteira foi pedida pela última vez (null = nada pendente). */
  lastResyncAt: number | null;
}

/** A ponte só manda texto e SGR; o resto (outros ESC, C0, DEL, C1) sairia do quadro ou travaria a aba. */
export function sanitizeLine(text: string): string {
  return text.replace(/\x1b\[[0-9;:]*m|[\x00-\x1f\x7f-\x9f]/g, (match) => (match.length > 1 ? match : ""));
}

/** Aplica um quadro num terminal (xterm.js no navegador, headless nos testes). */
export function applyFrame(target: FrameTarget, frame: FrameBody, state: FrameState, now = Date.now()): "ok" | "gap" | "waiting" {
  if (!frame.key && (state.lastSeq === null || frame.seq !== state.lastSeq + 1)) {
    if (state.lastResyncAt !== null && now - state.lastResyncAt < RESYNC_RETRY_MS) return "waiting";
    state.lastResyncAt = now;
    return "gap";
  }
  let out = "";
  if (frame.key) {
    if (target.cols !== frame.cols || target.rows !== frame.rows) target.resize(frame.cols, frame.rows);
    // Sem quebra automática (?7l): uma linha mais larga que cols não rola a tela. As linhas são filtradas, nada a religa.
    out += "\x1b[0m\x1b[?7l\x1b[2J";
  }
  for (const [row, text] of frame.lines) out += `\x1b[${row + 1};1H\x1b[0m\x1b[2K${sanitizeLine(text)}`;
  out += `\x1b[0m\x1b[${frame.cursor.y + 1};${frame.cursor.x + 1}H${frame.cursor.visible ? "\x1b[?25h" : "\x1b[?25l"}`;
  target.write(out);
  state.lastSeq = frame.seq;
  return "ok";
}
