import { describe, expect, it } from "vitest";
import { FrameDiffer } from "../src/mirror/differ.js";
import type { Snapshot } from "../src/screen/snapshot.js";

const cursor = { x: 0, y: 0, visible: true };
const snapOf = (lines: string[], extra: Partial<Snapshot> = {}): Snapshot => ({ cols: 40, rows: lines.length, cursor, lines, ...extra });

describe("FrameDiffer", () => {
  it("primeiro retrato vira quadro-chave com todas as linhas", () => {
    const frames = new FrameDiffer().next(snapOf(["a", "b"]));
    expect(frames).toEqual([{ seq: 1, key: true, cols: 40, rows: 2, cursor, lines: [[0, "a"], [1, "b"]] }]);
  });

  it("sem mudança não gera quadro; mudança gera só as linhas alteradas", () => {
    const differ = new FrameDiffer();
    differ.next(snapOf(["a", "b"]));
    expect(differ.next(snapOf(["a", "b"]))).toEqual([]);
    expect(differ.next(snapOf(["a", "c"]))).toEqual([{ seq: 2, key: false, cols: 40, rows: 2, cursor, lines: [[1, "c"]] }]);
  });

  it("cursor que se mexe gera quadro sem linhas", () => {
    const differ = new FrameDiffer();
    differ.next(snapOf(["a"]));
    const moved = { x: 1, y: 0, visible: true };
    expect(differ.next(snapOf(["a"], { cursor: moved }))).toEqual([{ seq: 2, key: false, cols: 40, rows: 1, cursor: moved, lines: [] }]);
  });

  it("mudança de tamanho e reset geram quadro-chave", () => {
    const differ = new FrameDiffer();
    differ.next(snapOf(["a"]));
    expect(differ.next(snapOf(["a"], { cols: 30 }))[0]!.key).toBe(true);
    differ.reset();
    expect(differ.next(snapOf(["a"], { cols: 30 }))[0]!.key).toBe(true);
  });

  it("divide o quadro-chave grande em partes, só a primeira com key", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(40));
    const frames = new FrameDiffer(1024 + 120).next(snapOf(lines));
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.map((f) => f.key)).toEqual([true, ...frames.slice(1).map(() => false)]);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    expect(frames.flatMap((f) => f.lines.map(([row]) => row))).toEqual([0, 1, 2, 3, 4]);
  });
});
