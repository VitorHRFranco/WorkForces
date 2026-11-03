import type { JSX } from "preact";

/** Letras em pixel art (8×8, `#` = pixel aceso). Não são os logotipos das empresas. */
const MAPS = {
  claude: ["..####..", ".##..##.", "##......", "##......", "##......", ".##..##.", "..####..", "........"],
  codex: ["##....##", ".##..##.", "..####..", "...##...", "..####..", ".##..##.", "##....##", "........"],
  gemini: ["..####..", ".##..##.", "##......", "##..###.", "##...##.", ".##..##.", "..####..", "........"],
} as const;

const COLORS = { claude: "#d97757", codex: "#5b9cff", gemini: "#a371f7" } as const;

export type AiId = keyof typeof MAPS;

export function AiIcon({ ai, disabled = false, size = 24 }: { ai: AiId; disabled?: boolean; size?: number }) {
  const rects: JSX.Element[] = [];
  MAPS[ai].forEach((line, y) => {
    for (let x = 0; x < 8; x++) if (line[x] === "#") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
  });
  return (
    <svg
      viewBox="0 0 8 8"
      width={size}
      height={size}
      fill={COLORS[ai]}
      shape-rendering="crispEdges"
      aria-hidden="true"
      style={disabled ? { opacity: 0.35 } : undefined}
    >
      {rects}
    </svg>
  );
}
