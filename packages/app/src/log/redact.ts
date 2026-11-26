import { BUILTIN_PATTERNS, findMaskRanges, type MaskPattern } from "@workforces/bridge/masking";

const MASK = "••••";

/** Segredos que só existem no app: convite, code= de OAuth e sessão/cookie. */
const APP_PATTERNS: readonly MaskPattern[] = [
  { name: "invite-code", regex: /\/invites?\/([A-Za-z0-9_-]+)/dg, group: 1 },
  { name: "query-code", regex: /[?&]code=([^&\s#"']+)/dg, group: 1 },
  // Cabeçalho Cookie/Set-Cookie: o valor inteiro, até o fim da linha.
  { name: "cookie-header", regex: /\b(?:set-)?cookie\s*:\s*([^\r\n]+)/dgi, group: 1 },
  // JSON ou util.inspect: "wf_session":"…", { session: '…' }.
  { name: "json-session", regex: /(?:session|sessionId|cookie)["']?\s*:\s*["']([^"']+)["']/dgi, group: 1 },
  // chave=valor, com prefixo permitido (wf_session=…).
  { name: "kv-session", regex: /(?:session|sessionId|cookie)=([^\s&;,"']+)/dgi, group: 1 },
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
