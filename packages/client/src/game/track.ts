import type { Point } from "@workforces/protocol";

export const INTERPOLATION_DELAY_MS = 100;
const MAX_SAMPLES = 20;

interface Sample {
  t: number;
  x: number;
  y: number;
}

/** Posições recebidas de outro jogador, desenhadas ~100 ms atrás para o movimento ficar suave (spec 8). */
export class Track {
  private samples: Sample[] = [];

  push(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  at(t: number): Point | null {
    const samples = this.samples;
    const first = samples[0];
    if (!first) return null;
    const target = t - INTERPOLATION_DELAY_MS;
    if (target <= first.t) return { x: first.x, y: first.y };
    for (let i = samples.length - 1; i >= 0; i--) {
      const a = samples[i]!;
      if (a.t > target) continue;
      const b = samples[i + 1];
      if (!b) return { x: a.x, y: a.y };
      const k = (target - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    return { x: first.x, y: first.y };
  }

  last(): Point | null {
    const sample = this.samples.at(-1);
    return sample ? { x: sample.x, y: sample.y } : null;
  }
}
