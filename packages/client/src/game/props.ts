import type { MapProp, Point, Rect } from "@workforces/protocol";
import data from "./props.json";
import { feetBox } from "./people";

/** Um móvel no atlas props.png (gerado por tools/art/build_art.py). `solid` é relativo à âncora (meio da base). */
export interface PropDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** [esquerda, topo, largura, altura], ou null quando o móvel não bloqueia a passagem. */
  solid: number[] | null;
}

const PROPS: Record<string, PropDef> = data;

/** O móvel com esse nome no atlas, ou null (o mapa pode citar um nome que o atlas não tem). */
export function propDef(sprite: string): PropDef | null {
  return Object.hasOwn(PROPS, sprite) ? PROPS[sprite]! : null;
}

/** A âncora dentro da imagem: o meio da base, arredondado para baixo para não cair em meio pixel. */
export function propOrigin(def: PropDef): Point {
  return { x: Math.floor(def.w / 2), y: def.h };
}

/** O retângulo que bloqueia a passagem, em pixels do mapa; null se o móvel não bloqueia ou não existe no atlas. */
export function solidRect(prop: MapProp): Rect | null {
  const solid = propDef(prop.sprite)?.solid;
  if (!solid) return null;
  const [left, top, width, height] = solid;
  return { x: prop.x + left, y: prop.y + top, width, height };
}

/** Os pés em `at` entram em algum bloqueio? Encostar na borda não conta. */
export function feetBlocked(at: Point, solids: readonly Rect[]): boolean {
  const box = feetBox(at);
  return solids.some((solid) => box.x < solid.x + solid.width && solid.x < box.x + box.width && box.y < solid.y + solid.height && solid.y < box.y + box.height);
}
