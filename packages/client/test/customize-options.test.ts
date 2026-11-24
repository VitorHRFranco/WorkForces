import { describe, expect, it } from "vitest";
import { Appearance, BEARDS, BROWS, FEET, GLASSES, HAIR_STYLES, LEGACY, LEGS, RAMPS, TOPS } from "@workforces/protocol";
import { LABELS, randomAppearance, swatches, withBody } from "../src/customize/options";

/** Gerador com semente (LCG), para o sorteio ser repetível no teste. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("randomAppearance", () => {
  it("500 sorteios: todos válidos, Feminino nunca com barba, os dois corpos e algum opcional", () => {
    const random = seeded(42);
    const drawn = Array.from({ length: 500 }, () => randomAppearance(random));
    for (const appearance of drawn) {
      expect(Appearance.safeParse(appearance).success).toBe(true);
      if (appearance.body === "feminine") expect(appearance.beard).toBeNull();
    }
    expect(new Set(drawn.map((a) => a.body))).toEqual(new Set(["feminine", "masculine"]));
    expect(drawn.some((a) => a.cardigan !== null || a.suspenders !== null || a.glasses !== null || a.bowtie !== null)).toBe(true);
    expect(drawn.some((a) => a.beard !== null)).toBe(true);
  });
});

describe("withBody", () => {
  it("no Feminino a barba sai e o resto fica; voltar ao Masculino não inventa barba", () => {
    const bearded = { ...LEGACY[0], beard: "facial-06" as const };
    const feminine = withBody(bearded, "feminine");
    expect(feminine).toEqual({ ...bearded, body: "feminine", beard: null });
    expect(withBody(feminine, "masculine").beard).toBeNull();
  });
});

describe("LABELS e swatches", () => {
  it("toda peça do catálogo tem nome em português", () => {
    for (const id of [...HAIR_STYLES, ...BEARDS, ...BROWS, ...TOPS, ...LEGS, ...FEET, ...GLASSES]) expect(LABELS[id], id).toBeTruthy();
  });

  it("as amostras são as cores prontas da família, com o tom do meio", () => {
    expect(swatches("clothing")).toHaveLength(75);
    expect(swatches("skin")).toHaveLength(9);
    for (const { name, hex } of swatches("clothing")) {
      const ramp = (RAMPS.clothing.named as Record<string, readonly string[]>)[name]!;
      expect(hex).toBe(ramp[Math.floor(ramp.length / 2)]);
    }
  });
});
