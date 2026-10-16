import type { FrameBody } from "@workforces/protocol";

export interface FrameTarget {
  readonly cols: number;
  readonly rows: number;
  resize(cols: number, rows: number): void;
  write(data: string): void;
}

export interface FrameState {
  lastSeq: number | null;
}

/** Aplica um quadro num terminal (xterm.js no navegador, headless nos testes). */
export function applyFrame(target: FrameTarget, frame: FrameBody, state: FrameState): "ok" | "gap" {
  if (!frame.key && (state.lastSeq === null || frame.seq !== state.lastSeq + 1)) return "gap";
  let out = "";
  if (frame.key) {
    if (target.cols !== frame.cols || target.rows !== frame.rows) target.resize(frame.cols, frame.rows);
    out += "\x1b[0m\x1b[2J";
  }
  for (const [row, text] of frame.lines) out += `\x1b[${row + 1};1H\x1b[0m\x1b[2K${text}`;
  out += `\x1b[0m\x1b[${frame.cursor.y + 1};${frame.cursor.x + 1}H${frame.cursor.visible ? "\x1b[?25h" : "\x1b[?25l"}`;
  target.write(out);
  state.lastSeq = frame.seq;
  return "ok";
}
