import { describe, expect, it } from "vitest";
import { bumpGeneration, currentGeneration, onGeneration } from "../src/generation";

describe("geração de rota", () => {
  it("sobe a cada rota do app e avisa quem escuta", () => {
    const seen: number[] = [];
    const off = onGeneration(() => seen.push(currentGeneration()));
    const before = currentGeneration();
    bumpGeneration();
    expect(currentGeneration()).toBe(before + 1);
    expect(seen).toEqual([before + 1]);
    off();
    bumpGeneration();
    expect(seen).toEqual([before + 1]);
  });
});
