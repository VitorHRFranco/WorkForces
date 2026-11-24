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
 * (`#rrggbb`), a rampa calculada por `freeRamp`. Outra coisa lança.
 */
export function rampFor(family: Family, color: string): readonly string[] {
  const named: Record<string, readonly string[]> = RAMPS[family].named;
  if (Object.hasOwn(named, color)) return named[color]!;
  if (!HEX.test(color)) throw new Error(`cor desconhecida: ${color}`);
  return freeRamp(family, color.toLowerCase());
}

type Lab = [number, number, number];

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

/** sRGB (0–255) → OKLab (Björn Ottosson). */
function toOklab(hex: string): Lab {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRGB linear (pode sair do intervalo 0–1). */
function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb: [number, number, number]): boolean => rgb.every((v) => v >= -1e-7 && v <= 1 + 1e-7);

/** OKLab → `#rrggbb`: fora do que a tela mostra, tira saturação (mantém a luminosidade, e com ela a ordem da rampa). */
function oklabToHex([L, a, b]: Lab): string {
  const lightness = Math.min(1, Math.max(0, L));
  let lo = 0;
  let hi = 1;
  if (!inGamut(oklabToLinear([lightness, a, b]))) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear([lightness, a * mid, b * mid]))) lo = mid;
      else hi = mid;
    }
  } else lo = 1;
  const linear = oklabToLinear([lightness, a * lo, b * lo]);
  return `#${linear.map((v) => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, v)))))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A rampa de uma cor livre, com o sombreado de uma rampa feita à mão (anti-objetivo 1): a cor pronta da família de tom do
 * meio mais perto (no OKLab) é deslocada inteira pela diferença entre a cor escolhida e esse tom do meio.
 */
export function freeRamp(family: Family, hex: string): readonly string[] {
  const target = toOklab(hex);
  let base: readonly string[] = [];
  let baseMiddle: Lab = [0, 0, 0];
  let bestDistance = Infinity;
  for (const ramp of Object.values(RAMPS[family].named) as readonly (readonly string[])[]) {
    const middle = toOklab(ramp[Math.floor(ramp.length / 2)]!);
    const distance = (middle[0] - target[0]) ** 2 + (middle[1] - target[1]) ** 2 + (middle[2] - target[2]) ** 2;
    if (distance < bestDistance) [base, baseMiddle, bestDistance] = [ramp, middle, distance];
  }
  if (bestDistance === 0) return base;
  const delta: Lab = [target[0] - baseMiddle[0], target[1] - baseMiddle[1], target[2] - baseMiddle[2]];
  const shifted = base.map((tone): Lab => {
    const [L, a, b] = toOklab(tone);
    return [L + delta[0], a + delta[1], b + delta[2]];
  });
  // Nos extremos (preto, branco, amarelo forte), deslocar a rampa inteira jogaria tons para além do preto ou do branco, e
  // eles virariam o mesmo tom. O tom do meio fica dentro de uma faixa, e os de baixo e os de cima são comprimidos para
  // caber entre ele e as pontas, mantendo a ordem e os tons distintos.
  const middle = Math.floor(shifted.length / 2);
  const middleL = Math.min(MIDDLE_L_MAX, Math.max(MIDDLE_L_MIN, shifted[middle]![0]));
  const offsets = shifted.map(([L]) => L - shifted[middle]![0]);
  const below = Math.min(0, ...offsets);
  const above = Math.max(0, ...offsets);
  const shrinkBelow = below < 0 ? Math.min(1, (middleL - TONE_L_MIN) / -below) : 1;
  const shrinkAbove = above > 0 ? Math.min(1, (TONE_L_MAX - middleL) / above) : 1;
  return shifted.map(([, a, b], i) => {
    const offset = offsets[i]!;
    return oklabToHex([middleL + offset * (offset < 0 ? shrinkBelow : shrinkAbove), a, b]);
  });
}

/** Faixa de luminosidade (OKLab) do tom do meio de uma rampa livre e das pontas dela: longe o bastante do preto e do branco puros para os tons não se repetirem. */
const MIDDLE_L_MIN = 0.2;
const MIDDLE_L_MAX = 0.88;
const TONE_L_MIN = 0.04;
const TONE_L_MAX = 0.98;

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
