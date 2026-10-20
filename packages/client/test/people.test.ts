import { describe, expect, it } from "vitest";
import { PEOPLE_VARIANTS, animKey, personVariant, poseFrames, poseOf } from "../src/game/people";

describe("pessoas", () => {
  it("cada conta tem uma variante fixa; as 12 primeiras contas são todas diferentes", () => {
    expect(personVariant(7)).toBe(personVariant(7));
    const first = Array.from({ length: 12 }, (_, i) => personVariant(i + 1));
    expect(new Set(first).size).toBe(PEOPLE_VARIANTS);
    expect(first.every((variant) => variant >= 0 && variant < PEOPLE_VARIANTS)).toBe(true);
    expect(personVariant(13)).toBe(personVariant(1));
  });

  it("anda, para e senta com a pose certa", () => {
    expect(poseOf(true, "left", null)).toEqual({ kind: "walk", dir: "left" });
    expect(poseOf(false, "left", null)).toEqual({ kind: "idle", dir: "left" });
    expect(poseOf(false, "left", "up")).toEqual({ kind: "sit", dir: "up" });
    expect(poseOf(true, "left", "up")).toEqual({ kind: "walk", dir: "left" }); // andando não senta
  });

  it("acha os quadros na folha people.png: 12 por linha, 4 linhas por variante", () => {
    expect(poseFrames(0, { kind: "walk", dir: "up" })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(poseFrames(0, { kind: "idle", dir: "down" })).toEqual([32, 33, 34, 33]);
    expect(poseFrames(1, { kind: "sit", dir: "right" })).toEqual([95]);
    expect(poseFrames(11, { kind: "walk", dir: "right" }).at(-1)).toBe(571); // último quadro de andar da folha (576 quadros)
    expect(animKey(3, { kind: "sit", dir: "up" })).toBe("person-3-sit-up");
  });
});
