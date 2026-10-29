export interface TokenOffice {
  url: string;
  session: string | null;
  bridgeToken: string | null;
}

export type TokenResult = { ok: true; token: string; created: boolean } | { ok: false; error: "no-office" | "office-down" | "spawn-failed" };

const TOKEN_TIMEOUT_MS = 10_000;
const MAX_TOKEN_NAME = 40;

/** O nome do token no painel "Computadores": `app <nome do computador>`, no limite do servidor. */
export function tokenName(host: string): string {
  return `app ${host}`.slice(0, MAX_TOKEN_NAME);
}

/** Pede ao escritório; `null` se a rede falhou. */
async function ask(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

/** Garante um token da ponte aceito pelo escritório: usa o guardado, ou cria outro com a sessão. */
export async function ensureBridgeToken(office: TokenOffice, name: string, fetchImpl: typeof fetch = fetch): Promise<TokenResult> {
  if (office.session === null) return { ok: false, error: "no-office" };
  const base = office.url.replace(/\/+$/, "");
  if (office.bridgeToken !== null) {
    const check = await ask(fetchImpl, `${base}/api/bridge/whoami`, { headers: { authorization: `Bearer ${office.bridgeToken}` } });
    if (check === null) return { ok: false, error: "office-down" };
    if (check.status === 200) return { ok: true, token: office.bridgeToken, created: false };
    if (check.status !== 401) return { ok: false, error: "spawn-failed" };
  }
  const made = await ask(fetchImpl, `${base}/api/tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${office.session}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (made === null) return { ok: false, error: "office-down" };
  if (made.status === 401) return { ok: false, error: "no-office" };
  if (made.status !== 201) return { ok: false, error: "spawn-failed" };
  try {
    const body = (await made.json()) as { token?: unknown };
    if (typeof body.token !== "string" || body.token === "") return { ok: false, error: "spawn-failed" };
    return { ok: true, token: body.token, created: true };
  } catch {
    return { ok: false, error: "spawn-failed" };
  }
}
