import { LAYER_ORDER, PARTS, RAMPS, type Appearance } from "@workforces/protocol";

/** Uma imagem em RGBA (8 bits por canal, sem pré-multiplicar), como a `ImageData` do canvas. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Family = keyof typeof RAMPS;

/** Uma camada da aparência: o arquivo da peça (em `sprites/parts/`), a família de cores e a rampa de destino. */
export interface Layer {
  file: string;
  family: Family;
  to: readonly string[];
}

/** Lado da folha de uma pessoa: 12 colunas e 4 linhas de quadros de 64 px. */
export const SHEET_WIDTH = 768;
export const SHEET_HEIGHT = 256;

type Body = Appearance["body"];
interface PartEntry {
  family: Family;
  file?: string;
  byBody?: Record<Body, string>;
  behind?: string;
}
const parts: Record<string, PartEntry> = PARTS;

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A rampa de uma cor: a da cor pronta do LPC com esse nome (só os nomes da própria família); para uma cor livre
 * (`#rrggbb`), por enquanto, a cor pronta cujo tom do meio fica mais perto dela (o plano 3 troca isso por uma rampa
 * calculada a partir da cor). Outra coisa lança.
 */
export function rampFor(family: Family, color: string): readonly string[] {
  const named: Record<string, readonly string[]> = RAMPS[family].named;
  if (Object.hasOwn(named, color)) return named[color]!;
  if (!HEX.test(color)) throw new Error(`cor desconhecida: ${color}`);
  const [r, g, b] = rgbOf(color);
  let best: readonly string[] = [];
  let bestDistance = Infinity;
  for (const ramp of Object.values(named)) {
    const [mr, mg, mb] = rgbOf(ramp[Math.floor(ramp.length / 2)]!);
    const distance = (mr - r) ** 2 + (mg - g) ** 2 + (mb - b) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [ramp, distance];
  }
  return best;
}

/** Troca cada tom `from[i]` por `to[i]`; os outros pixels (tons fixos) e a transparência ficam. Não mexe na entrada. */
export function recolor(image: Rgba, from: readonly string[], to: readonly string[]): Rgba {
  const swap = new Map<number, [number, number, number]>();
  from.forEach((tone, i) => {
    const [r, g, b] = rgbOf(tone);
    swap.set((r << 16) | (g << 8) | b, rgbOf(to[i]!));
  });
  const data = new Uint8ClampedArray(image.data);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    const target = swap.get((data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!);
    if (target) [data[p], data[p + 1], data[p + 2]] = target;
  }
  return { width: image.width, height: image.height, data };
}

function fileOf(id: string, body: Body): string {
  const entry = parts[id]!;
  return entry.file ?? entry.byBody![body];
}

/** As camadas da aparência, de baixo para cima (`LAYER_ORDER`). Sobrancelha e barba usam a cor do cabelo. */
export function layersOf(appearance: Appearance): Layer[] {
  const { body, hair } = appearance;
  const hairRamp = rampFor("hair", hair.color);
  const skinRamp = rampFor("skin", appearance.skin);
  const clothing = (id: string, color: string): Layer => ({ file: fileOf(id, body), family: "clothing", to: rampFor("clothing", color) });
  const layers: Layer[] = [];
  for (const slot of LAYER_ORDER) {
    switch (slot) {
      case "hair-behind": {
        const behind = parts[hair.style]!.behind;
        if (behind) layers.push({ file: behind, family: "hair", to: hairRamp });
        break;
      }
      case "body":
      case "head":
        layers.push({ file: fileOf(slot, body), family: "skin", to: skinRamp });
        break;
      case "feet":
      case "legs":
      case "top":
        layers.push(clothing(appearance[slot].style, appearance[slot].color));
        break;
      case "suspenders":
      case "cardigan":
      case "bowtie": {
        const color = appearance[slot];
        if (color !== null) layers.push(clothing(slot, color));
        break;
      }
      case "brows":
      case "beard": {
        const id = appearance[slot];
        if (id !== null) layers.push({ file: fileOf(id, body), family: "hair", to: hairRamp });
        break;
      }
      case "glasses":
        if (appearance.glasses) {
          layers.push({ file: fileOf(appearance.glasses.style, body), family: "metal", to: rampFor("metal", appearance.glasses.color) });
        }
        break;
      case "hair":
        layers.push({ file: fileOf(hair.style, body), family: "hair", to: hairRamp });
        break;
    }
  }
  return layers;
}

/** Põe `top` por cima de `under` (composição "por cima", com alfa; no LPC os alfas são só 0 e 255). */
function over(under: Uint8ClampedArray, top: Uint8ClampedArray): void {
  for (let p = 0; p < top.length; p += 4) {
    const alpha = top[p + 3]!;
    if (alpha === 0) continue;
    if (alpha === 255 || under[p + 3] === 0) {
      under.set(top.subarray(p, p + 4), p);
      continue;
    }
    const a = alpha / 255;
    const b = (under[p + 3]! / 255) * (1 - a);
    const out = a + b;
    for (let c = 0; c < 3; c++) under[p + c] = Math.round((top[p + c]! * a + under[p + c]! * b) / out);
    under[p + 3] = Math.round(out * 255);
  }
}

/** A folha de uma pessoa (768x256): cada camada recolorida da rampa de referência da família e posta por cima da anterior. */
export function composeSheet(appearance: Appearance, part: (file: string) => Rgba): Rgba {
  const data = new Uint8ClampedArray(SHEET_WIDTH * SHEET_HEIGHT * 4);
  for (const layer of layersOf(appearance)) {
    const image = part(layer.file);
    if (image.width !== SHEET_WIDTH || image.height !== SHEET_HEIGHT) {
      throw new Error(`a peça ${layer.file} tem ${image.width}x${image.height}, e não ${SHEET_WIDTH}x${SHEET_HEIGHT}`);
    }
    over(data, recolor(image, RAMPS[layer.family].reference, layer.to).data);
  }
  return { width: SHEET_WIDTH, height: SHEET_HEIGHT, data };
}
