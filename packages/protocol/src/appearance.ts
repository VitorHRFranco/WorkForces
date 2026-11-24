import { z } from "zod";
import { BEARDS, CATALOG_VERSION, BODIES, BROWS, CLOTHING_COLORS, FEET, GLASSES, HAIR_COLORS, HAIR_STYLES, LEGS, METALS, SKINS, TOPS } from "./people-catalog.js";

/** Cor livre, em minúsculas. */
export const Hex = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * Cor de uma peça: o nome de uma cor pronta do LPC (a rampa exata dela) ou uma cor livre. O nome, e não o tom, porque na
 * paleta do LPC cores diferentes dividem tons.
 */
const HairColor = z.union([z.enum(HAIR_COLORS), Hex]);
const ClothingColor = z.union([z.enum(CLOTHING_COLORS), Hex]);
const MetalColor = z.union([z.enum(METALS), Hex]);

/** A aparência de um personagem: as escolhas de cada parte, não a imagem. Sobrancelha e barba usam a cor do cabelo. */
export const Appearance = z
  .object({
    v: z.literal(CATALOG_VERSION),
    body: z.enum(BODIES),
    skin: z.enum(SKINS),
    hair: z.object({ style: z.enum(HAIR_STYLES), color: HairColor }),
    brows: z.enum(BROWS).nullable(),
    beard: z.enum(BEARDS).nullable(),
    top: z.object({ style: z.enum(TOPS), color: ClothingColor }),
    cardigan: ClothingColor.nullable(),
    suspenders: ClothingColor.nullable(),
    legs: z.object({ style: z.enum(LEGS), color: ClothingColor }),
    feet: z.object({ style: z.enum(FEET), color: ClothingColor }),
    glasses: z.object({ style: z.enum(GLASSES), color: MetalColor }).nullable(),
    bowtie: ClothingColor.nullable(),
  })
  .refine((appearance) => appearance.beard === null || appearance.body === "masculine", {
    message: "barba e bigode só no corpo masculino",
    path: ["beard"],
  });
export type Appearance = z.infer<typeof Appearance>;

/** A aparência se ela vale neste catálogo; senão null (de outra versão, malformada ou ausente). Nunca lança. */
export function parseAppearance(value: unknown): Appearance | null {
  const parsed = Appearance.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Texto que identifica a aparência: o JSON com as chaves sempre na mesma ordem, qualquer que seja a do objeto. */
export function appearanceKey(appearance: Appearance): string {
  const { v, body, skin, hair, brows, beard, top, cardigan, suspenders, legs, feet, glasses, bowtie } = appearance;
  const piece = (chosen: { style: string; color: string }) => ({ style: chosen.style, color: chosen.color });
  return JSON.stringify({
    v,
    body,
    skin,
    hair: piece(hair),
    brows,
    beard,
    top: piece(top),
    cardigan,
    suspenders,
    legs: piece(legs),
    feet: piece(feet),
    glasses: glasses && piece(glasses),
    bowtie,
  });
}
