import {
  BEARDS,
  BROWS,
  CLOTHING_COLORS,
  FEET,
  GLASSES,
  HAIR_COLORS,
  HAIR_STYLES,
  LEGS,
  METALS,
  RAMPS,
  SKINS,
  TOPS,
  CATALOG_VERSION,
  type Appearance,
} from "@workforces/protocol";
import type { Family } from "../game/compose";

type Body = Appearance["body"];

export const BODY_LABELS: Record<Body, string> = { feminine: "Feminino", masculine: "Masculino" };

/** O nome de cada peça na tela. */
export const LABELS: Record<string, string> = {
  "medium-01": "Pajem",
  "medium-02": "Cacheado",
  "medium-03": "Idol",
  "medium-04": "Franja e coque",
  "medium-05": "Tranças nagô",
  "medium-06": "Dreadlocks",
  "medium-07": "Chanel, risca de lado",
  "medium-08": "Chanel com franja",
  "medium-09": "Twists",
  "medium-10": "Twists com degradê",
  "short-01": "Raspado",
  "short-02": "Repartido",
  "short-03": "Cacheado curto",
  "short-04": "Topete",
  "short-05": "Natural",
  "short-06": "Calvície",
  "short-07": "Flat top",
  "short-08": "Flat top com degradê",
  "facial-01": "Bigode morsa",
  "facial-02": "Bigode chevron",
  "facial-03": "Bigode guidão",
  "facial-04": "Bigode largo",
  "facial-05": "Bigode ferradura",
  "facial-06": "Barba aparada",
  "facial-07": "Barba média",
  "brows-01": "Finas",
  "brows-02": "Grossas",
  "shirt-01": "Manga longa",
  "shirt-02": "Manga longa, gola V",
  "shirt-03": "Manga longa, gola canoa",
  "shirt-04": "Camiseta",
  "shirt-05": "Camiseta, gola V",
  "shirt-06": "Camiseta, gola canoa",
  "shirt-07": "Camisa de manga longa",
  "shirt-08": "Camisa de manga curta",
  "shirt-09": "Polo",
  "pants-01": "Meia-calça",
  "pants-02": "Legging",
  "pants-03": "Calça",
  "pants-04": "Calça dobrada",
  "pants-05": "Macacão",
  "shorts-01": "Bermuda",
  "shorts-02": "Short",
  shoes: "Sapato",
  boots: "Bota",
  "socks-ankle": "Meia curta",
  "socks-high": "Meia alta",
  "glasses-01": "Óculos",
  "glasses-02": "Meia-lua",
};

/** Troca o corpo; no Feminino, a barba sai (barba e bigode só no Masculino). */
export function withBody(appearance: Appearance, body: Body): Appearance {
  return { ...appearance, body, beard: body === "feminine" ? null : appearance.beard };
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
const chance = (probability: number, random: () => number): boolean => random() < probability;

/** Uma aparência sorteada, sempre válida: cores prontas, barba só no Masculino, opcionais de vez em quando. */
export function randomAppearance(random: () => number = Math.random): Appearance {
  const body = pick(["feminine", "masculine"] as const, random);
  const clothing = () => pick(CLOTHING_COLORS, random);
  return {
    v: CATALOG_VERSION,
    body,
    skin: pick(SKINS, random),
    hair: { style: pick(HAIR_STYLES, random), color: pick(HAIR_COLORS, random) },
    brows: pick(BROWS, random),
    beard: body === "masculine" && chance(0.4, random) ? pick(BEARDS, random) : null,
    top: { style: pick(TOPS, random), color: clothing() },
    cardigan: chance(0.25, random) ? clothing() : null,
    suspenders: chance(0.25, random) ? clothing() : null,
    legs: { style: pick(LEGS, random), color: clothing() },
    feet: { style: pick(FEET, random), color: clothing() },
    glasses: chance(0.25, random) ? { style: pick(GLASSES, random), color: pick(METALS, random) } : null,
    bowtie: chance(0.25, random) ? clothing() : null,
  };
}

/** As cores prontas da família, com o tom do meio da rampa como amostra. */
export function swatches(family: Family): readonly { name: string; hex: string }[] {
  const named = RAMPS[family].named as Record<string, readonly string[]>;
  return Object.entries(named).map(([name, ramp]) => ({ name, hex: ramp[Math.floor(ramp.length / 2)]! }));
}
