import { describe, expect, it } from "vitest";
import { appearanceKey } from "@workforces/protocol";
import { animKey, legacyAppearance, poseFrames, poseOf } from "../src/game/people";

describe("pessoas", () => {
  it("cada conta tem a aparência de hoje pelo id; as 12 primeiras são todas diferentes, e o id 13 volta à do 1", () => {
    expect(legacyAppearance(7)).toEqual(legacyAppearance(7));
    const first = Array.from({ length: 12 }, (_, i) => appearanceKey(legacyAppearance(i + 1)));
    expect(new Set(first).size).toBe(12);
    expect(legacyAppearance(13)).toEqual(legacyAppearance(1));
  });

  it("anda, para e senta com a pose certa", () => {
    expect(poseOf(true, "left", null)).toEqual({ kind: "walk", dir: "left" });
    expect(poseOf(false, "left", null)).toEqual({ kind: "idle", dir: "left" });
    expect(poseOf(false, "left", "up")).toEqual({ kind: "sit", dir: "up" });
    expect(poseOf(true, "left", "up")).toEqual({ kind: "walk", dir: "left" }); // andando não senta
  });

  it("acha os quadros na folha de uma pessoa: 12 por linha, 4 linhas", () => {
    expect(poseFrames({ kind: "walk", dir: "up" })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(poseFrames({ kind: "idle", dir: "down" })).toEqual([32, 33, 34, 33]);
    expect(poseFrames({ kind: "sit", dir: "right" })).toEqual([47]);
    expect(animKey("person:x", { kind: "sit", dir: "up" })).toBe("person:x-sit-up");
  });
});
