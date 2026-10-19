/** Pessoas do 1-Bit Pack (índices no tileset; ver assets/CREDITS.md). */
export const AVATAR_FRAMES = [25, 76, 77, 78, 123, 124, 127, 171, 172, 173, 177, 221, 222, 225, 226, 470] as const;
/** O robô de cada agente. */
export const ROBOT_FRAME = 324;
/** Cores da paleta do pacote, aplicadas como tint sobre os sprites claros. */
export const TINTS = [0xcfc6b8, 0xe6482e, 0xbf7958, 0x38d973, 0xf4b41b, 0x3cacd7] as const;

/** Visual de cada pessoa, escolhido de forma determinística pelo id (spec 8). Os robôs usam a cor do dono. */
export function avatarFor(userId: number): { frame: number; tint: number } {
  const hash = Math.imul(userId, 2654435761) >>> 0;
  return {
    frame: AVATAR_FRAMES[hash % AVATAR_FRAMES.length]!,
    tint: TINTS[Math.floor(hash / AVATAR_FRAMES.length) % TINTS.length]!,
  };
}
