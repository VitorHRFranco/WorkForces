import { BUILTIN_PATTERNS, findMaskRanges, type MaskPattern } from "@workforces/bridge/masking";

const MASK = "••••";

/** Segredos que só existem no app: convite, code= de OAuth e sessão/cookie. */
const APP_PATTERNS: readonly MaskPattern[] = [
  { name: "invite-code", regex: /\/invite\/([A-Za-z0-9_-]+)/dg, group: 1 },
  { name: "query-code", regex: /[?&]code=([^&\s#"']+)/dg, group: 1 },
  { name: "json-session", regex: /"(?:session|sessionId|cookie)"\s*:\s*"([^"]+)"/dgi, group: 1 },
  { name: "kv-session", regex: /\b(?:session|sessionId|cookie)=([^\s&;,"']+)/dgi, group: 1 },
];

const ALL_PATTERNS: readonly MaskPattern[] = [...BUILTIN_PATTERNS, ...APP_PATTERNS];

/** Troca cada trecho secreto achado por "••••". */
export function redact(text: string): string {
  const ranges = findMaskRanges(text, ALL_PATTERNS);
  let out = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i]!;
    out = out.slice(0, start) + MASK + out.slice(end);
  }
  return out;
}
