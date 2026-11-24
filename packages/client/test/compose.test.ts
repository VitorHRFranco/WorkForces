import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { LEGACY, RAMPS } from "@workforces/protocol";
import { composeSheet, rampFor, recolor, type Rgba } from "../src/game/compose";

function readPng(url: URL): Rgba {
  const png = PNG.sync.read(readFileSync(fileURLToPath(url)));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

const partsDir = new URL("../public/sprites/parts/", import.meta.url);
const loaded = new Map<string, Rgba>();
const part = (file: string): Rgba => {
  let image = loaded.get(file);
  if (!image) loaded.set(file, (image = readPng(new URL(file, partsDir))));
  return image;
};

const rgba = (hex: string, alpha = 255): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(alpha);

describe("rampFor", () => {
  it("a cor com nome dá a rampa dela", () => {
    expect(rampFor("clothing", "Coral")).toEqual(RAMPS.clothing.named.Coral);
    expect(rampFor("skin", "Peach")).toEqual(RAMPS.skin.named.Peach);
    expect(rampFor("metal", "Gold")).toEqual(RAMPS.metal.named.Gold);
  });

  it("a cor livre usa, por enquanto, a rampa com nome de tom do meio mais perto", () => {
    const coral = RAMPS.clothing.named.Coral;
    const middle = coral[Math.floor(coral.length / 2)]!;
    expect(rampFor("clothing", middle)).toEqual(coral);
    const [r, g, b] = rgba(middle);
    const near = `#${[r! + 2, g! + 1, b!].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    expect(rampFor("clothing", near)).toEqual(coral);
  });

  it("o nome só vale se for uma cor da própria família", () => {
    expect(() => rampFor("clothing", "constructor")).toThrow("cor desconhecida");
    expect(() => rampFor("clothing", "Raven")).toThrow("cor desconhecida");
    expect(rampFor("hair", "Raven")).toEqual(RAMPS.hair.named.Raven);
  });
});

describe("recolor", () => {
  it("troca só os tons da rampa: o tom fixo e o pixel transparente ficam", () => {
    const from = RAMPS.clothing.reference;
    const to = RAMPS.clothing.named.Coral;
    const image: Rgba = { width: 3, height: 1, data: new Uint8ClampedArray([...rgba(from[0]), ...rgba("#271920"), ...rgba(from[0], 0)]) };
    const out = recolor(image, from, to);
    expect([...out.data]).toEqual([...rgba(to[0]), ...rgba("#271920"), ...rgba(from[0], 0)]);
    expect([...image.data.slice(0, 4)]).toEqual(rgba(from[0]));
  });
});

describe("composeSheet", () => {
  it("monta as 12 pessoas de hoje com os mesmos pixels da people.png antiga", () => {
    const legacy = readPng(new URL("./fixtures/people-legacy.png", import.meta.url));
    const band = 768 * 256 * 4;
    expect(legacy.width).toBe(768);
    expect(legacy.height).toBe(256 * LEGACY.length);
    LEGACY.forEach((appearance, i) => {
      const sheet = composeSheet(appearance, part);
      expect(sheet.width).toBe(768);
      expect(sheet.height).toBe(256);
      const expected = legacy.data.subarray(i * band, (i + 1) * band);
      const differing = sheet.data.findIndex((value, j) => value !== expected[j]);
      expect(differing, `pessoa ${i + 1}: primeiro byte diferente`).toBe(-1);
    });
  });
});
