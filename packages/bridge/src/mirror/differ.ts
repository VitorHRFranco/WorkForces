import { LIMITS, type FrameBody } from "@workforces/protocol";
import type { Snapshot } from "../screen/snapshot.js";

/** Folga para os campos fixos da mensagem (type, seq, cursor…). */
const FRAME_OVERHEAD_BYTES = 1024;

export class FrameDiffer {
  private last: Snapshot | null = null;
  private seq = 0;

  constructor(private readonly maxFrameBytes: number = LIMITS.maxFrameBytes) {}

  /** Esquece a última tela enviada: o próximo quadro será um quadro-chave. */
  reset(): void {
    this.last = null;
  }

  next(snapshot: Snapshot): FrameBody[] {
    const prev = this.last;
    const key = !prev || prev.cols !== snapshot.cols || prev.rows !== snapshot.rows;
    const changed: [number, string][] = [];
    for (let row = 0; row < snapshot.rows; row++) {
      const line = snapshot.lines[row] ?? "";
      if (key || prev?.lines[row] !== line) changed.push([row, line]);
    }
    const cursorMoved =
      !prev ||
      prev.cursor.x !== snapshot.cursor.x ||
      prev.cursor.y !== snapshot.cursor.y ||
      prev.cursor.visible !== snapshot.cursor.visible;
    if (!key && changed.length === 0 && !cursorMoved) return [];
    this.last = snapshot;
    return this.split(snapshot, key, changed);
  }

  private split(snapshot: Snapshot, key: boolean, changed: [number, string][]): FrameBody[] {
    const budget = this.maxFrameBytes - FRAME_OVERHEAD_BYTES;
    const frames: FrameBody[] = [];
    let lines: [number, string][] = [];
    let size = 0;
    const push = () => {
      frames.push({
        seq: ++this.seq,
        key: key && frames.length === 0,
        cols: snapshot.cols,
        rows: snapshot.rows,
        cursor: snapshot.cursor,
        lines,
      });
      lines = [];
      size = 0;
    };
    for (const entry of changed) {
      const entrySize = Buffer.byteLength(JSON.stringify(entry));
      if (lines.length > 0 && size + entrySize > budget) push();
      lines.push(entry);
      size += entrySize;
    }
    if (lines.length > 0 || frames.length === 0) push();
    return frames;
  }
}
