import type { Direction, Point, Rect } from "@workforces/protocol";

/** Folha people.png (gerada por tools/art/build_art.py): 12 variantes; cada uma ocupa 4 linhas (cima, esquerda, baixo, direita) de 12 quadros. */
export const PEOPLE_VARIANTS = 12;
/** Lado de cada quadro, em px. */
export const PERSON_FRAME = 64;
/** Linha dos pés dentro do quadro: a posição de uma pessoa no mapa é a dos pés. */
export const FOOT_Y = 62;

/** Caixa de colisão nos pés, em px do mapa: a cabeça passa na frente da parede e dos móveis, como numa vista de cima. */
export const FEET = { width: 16, height: 8 };

/** A caixa dos pés de quem está em `at` (com a base nos pés). */
export function feetBox(at: Point): Rect {
  return { x: at.x - FEET.width / 2, y: at.y - FEET.height, width: FEET.width, height: FEET.height };
}

const COLUMNS = 12;
const ROWS: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };
const WALK = [0, 1, 2, 3, 4, 5, 6, 7];
/** Parado: respira, indo e voltando. */
const IDLE = [8, 9, 10, 9];
const SIT = [11];

export type PoseKind = "walk" | "idle" | "sit";

export interface Pose {
  kind: PoseKind;
  dir: Direction;
}

/** Variante de cada conta, pela ordem do id (spec 8): as 12 primeiras contas ficam todas diferentes. */
export function personVariant(userId: number): number {
  return (userId - 1) % PEOPLE_VARIANTS;
}

/** Andando, parada ou sentada: só senta quem está parado num assento, e aí olha para onde o assento manda. */
export function poseOf(moving: boolean, dir: Direction, seatDir: Direction | null): Pose {
  if (!moving && seatDir !== null) return { kind: "sit", dir: seatDir };
  return { kind: moving ? "walk" : "idle", dir };
}

/** Quadros da pose na folha (numerados linha a linha, 12 por linha). */
export function poseFrames(variant: number, pose: Pose): number[] {
  const columns = pose.kind === "walk" ? WALK : pose.kind === "idle" ? IDLE : SIT;
  const row = variant * 4 + ROWS[pose.dir];
  return columns.map((column) => row * COLUMNS + column);
}

export const animKey = (variant: number, pose: Pose): string => `person-${variant}-${pose.kind}-${pose.dir}`;
