export const SESSION_COOKIE = "wf_session";
const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

/** A sessão vem como Bearer (o app) ou como cookie (o navegador); o Bearer tem prioridade. */
export function sessionIdOf(headers: { authorization?: string; cookie?: string }): string | null {
  return bearerToken(headers.authorization) ?? readCookie(headers.cookie, SESSION_COOKIE);
}

/**
 * A origem do pedido confere com a do escritório? Origin presente tem de ser a do escritório, com cookie ou sem: um
 * navegador num nome que aponta para este servidor (DNS rebinding) manda a origem dele. Cookie sem Origin também é
 * recusado. O app (fetch e ws do Node) não manda nenhum dos dois.
 */
export function originAllowed(headers: { origin?: string; cookie?: string }, origin: string): boolean {
  if (headers.origin === undefined && headers.cookie === undefined) return true;
  return headers.origin === origin;
}
