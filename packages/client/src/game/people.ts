import { LEGACY, parseAppearance, type Appearance, type Direction, type Point, type Rect } from "@workforces/protocol";

/** Lado de cada quadro, em px. A folha de uma pessoa, montada a partir da aparência (compose.ts), tem 4 linhas (cima, esquerda, baixo, direita) de 12 quadros. */
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

/** A aparência de quem ainda não escolheu a sua: uma das 12 de hoje, pela ordem do id (as 12 primeiras contas ficam todas diferentes). */
export function legacyAppearance(userId: number): Appearance {
  // Cópia: quem mexer no objeto devolvido não estraga a tabela.
  return structuredClone(LEGACY[(userId - 1) % LEGACY.length]!);
}

/** A aparência que a cena mostra para alguém: a que veio do servidor, se este catálogo a entende; senão, a de hoje pelo id. */
export function appearanceOf(player: { id: number; appearance?: unknown }): Appearance {
  return parseAppearance(player.appearance) ?? legacyAppearance(player.id);
}

/** Andando, parada ou sentada: só senta quem está parado num assento, e aí olha para onde o assento manda. */
export function poseOf(moving: boolean, dir: Direction, seatDir: Direction | null): Pose {
  if (!moving && seatDir !== null) return { kind: "sit", dir: seatDir };
  return { kind: moving ? "walk" : "idle", dir };
}

/** Quadros da pose na folha de uma pessoa (numerados linha a linha, 12 por linha). */
export function poseFrames(pose: Pose): number[] {
  const columns = pose.kind === "walk" ? WALK : pose.kind === "idle" ? IDLE : SIT;
  return columns.map((column) => ROWS[pose.dir] * COLUMNS + column);
}

/** A animação de uma pose na folha `textureKey` (a chave que `PeopleTextures.acquire` devolve). */
export const animKey = (textureKey: string, pose: Pose): string => `${textureKey}-${pose.kind}-${pose.dir}`;
