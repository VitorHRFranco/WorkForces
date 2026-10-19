import { describe, expect, it } from "vitest";
import { AVATAR_FRAMES, TINTS, avatarFor } from "../src/game/avatar";

describe("avatarFor", () => {
  it("é sempre o mesmo para a mesma pessoa e varia entre pessoas", () => {
    expect(avatarFor(7)).toEqual(avatarFor(7));
    const looks = Array.from({ length: 16 }, (_, i) => avatarFor(i + 1));
    for (const look of looks) {
      expect(AVATAR_FRAMES).toContain(look.frame);
      expect(TINTS).toContain(look.tint);
    }
    expect(new Set(looks.map((look) => `${look.frame}/${look.tint}`)).size).toBeGreaterThanOrEqual(10);
  });
});
