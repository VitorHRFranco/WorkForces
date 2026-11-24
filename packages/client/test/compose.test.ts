import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { LEGACY, RAMPS } from "@workforces/protocol";
import { composeSheet, freeRamp, rampFor, recolor, type Family, type Rgba } from "../src/game/compose";

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

  it("a cor livre usa a rampa calculada", () => {
    expect(rampFor("clothing", "#3a7d44")).toEqual(freeRamp("clothing", "#3a7d44"));
  });
});

/** Luminosidade aproximada (a ordem é o que importa): L do OKLab feito pelo teste, independente da implementação. */
function lightness(hex: string): number {
  const lin = rgba(hex)
    .slice(0, 3)
    .map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  const [r, g, b] = lin as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

describe("freeRamp", () => {
  it("o tom do meio de uma cor pronta devolve a rampa dela", () => {
    const coral = RAMPS.clothing.named.Coral;
    expect(freeRamp("clothing", coral[Math.floor(coral.length / 2)]!)).toEqual(coral);
  });

  const cases: [Family, string][] = [
    ...["#3a7d44", "#c0392b", "#2e86c1", "#f1c40f", "#8e44ad", "#7f8c8d", "#e67e22", "#16a085"].map((hex): [Family, string] => ["clothing", hex]),
    ["hair", "#a0522d"],
  ];
  it.each(cases)("%s %s: tons válidos, distintos, do escuro ao claro, com a cor no meio", (family, hex) => {
    const ramp = freeRamp(family, hex);
    expect(ramp).toHaveLength(RAMPS[family].reference.length);
    for (const tone of ramp) expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(ramp).size).toBe(ramp.length);
    for (let i = 1; i < ramp.length; i++) expect(lightness(ramp[i]!)).toBeGreaterThanOrEqual(lightness(ramp[i - 1]!) - 1e-9);
    const middle = rgba(ramp[Math.floor(ramp.length / 2)]!);
    const wanted = rgba(hex);
    for (let c = 0; c < 3; c++) expect(Math.abs(middle[c]! - wanted[c]!)).toBeLessThanOrEqual(2);
  });

  const extremes: [Family, string][] = [
    ["clothing", "#000000"],
    ["clothing", "#ffffff"],
    ["clothing", "#ffff00"],
    ["clothing", "#f0f0f0"],
    ["metal", "#ffffff"],
    ["metal", "#00ff00"],
  ];
  it.each(extremes)("%s %s: nos extremos, os tons continuam distintos e do escuro ao claro (sem virar borrão)", (family, hex) => {
    const ramp = freeRamp(family, hex);
    for (const tone of ramp) expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(ramp).size).toBe(ramp.length);
    for (let i = 1; i < ramp.length; i++) expect(lightness(ramp[i]!)).toBeGreaterThanOrEqual(lightness(ramp[i - 1]!) - 1e-9);
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
