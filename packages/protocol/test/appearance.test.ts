import { describe, expect, it } from "vitest";
import { Appearance, LEGACY, appearanceKey } from "../src/index.js";

const base = LEGACY[0];
const valid = (value: unknown) => Appearance.safeParse(value).success;

describe("Appearance", () => {
  it("as 12 aparências de hoje valem", () => {
    expect(LEGACY).toHaveLength(12);
    for (const appearance of LEGACY) expect(valid(appearance)).toBe(true);
  });

  it("barba e bigode só no corpo masculino", () => {
    expect(base.body).toBe("masculine");
    expect(valid({ ...base, beard: "facial-06" })).toBe(true);
    expect(valid({ ...base, body: "feminine", beard: "facial-06" })).toBe(false);
    expect(valid({ ...base, body: "feminine", beard: null })).toBe(true);
  });

  it("recusa peça, pele e cor fora do catálogo", () => {
    expect(valid({ ...base, hair: { ...base.hair, style: "short-99" } })).toBe(false);
    expect(valid({ ...base, skin: "Blue" })).toBe(false);
    expect(valid({ ...base, top: { ...base.top, color: "#ABCDEF" } })).toBe(false);
    // Cor com nome de outra família: Raven é cor de cabelo, não de roupa.
    expect(valid({ ...base, top: { ...base.top, color: "Raven" } })).toBe(false);
  });

  it("aceita a cor com nome da família e a cor livre em #rrggbb", () => {
    expect(valid({ ...base, top: { ...base.top, color: "#abcdef" } })).toBe(true);
    expect(valid({ ...base, hair: { ...base.hair, color: "Raven" } })).toBe(true);
    expect(valid({ ...base, glasses: { style: "glasses-01", color: "Gold" } })).toBe(true);
    expect(valid({ ...base, glasses: { style: "glasses-01", color: "Coral" } })).toBe(false);
  });

  it("appearanceKey: a mesma aparência dá o mesmo texto em qualquer ordem de chaves; outra aparência, outro texto", () => {
    const reordered = { ...Object.fromEntries(Object.entries(base).reverse()), hair: { color: base.hair.color, style: base.hair.style } } as Appearance;
    expect(appearanceKey(reordered)).toBe(appearanceKey(base));
    expect(appearanceKey(LEGACY[1])).not.toBe(appearanceKey(base));
    expect(appearanceKey({ ...base, bowtie: "Coral" })).not.toBe(appearanceKey(base));
  });
});
