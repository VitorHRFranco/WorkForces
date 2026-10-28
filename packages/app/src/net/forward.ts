import type { AuthChange, ForwardTarget } from "../state.js";

const SESSION_COOKIE = "wf_session=";
const FORWARD_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 3_000;
const BAD_GATEWAY = 502;
/** Só o que a página precisa ler da resposta; o resto (e sobretudo o `set-cookie`) fica no processo principal. */
const PAGE_RESPONSE_HEADERS = ["content-type", "cache-control"] as const;

/** O `wf_session` de um `Set-Cookie`: `set` com o valor, `cleared` se foi apagado, `null` se o cookie não veio. */
export function sessionFromSetCookie(values: readonly string[]): { kind: "set"; value: string } | { kind: "cleared" } | null {
  for (const cookie of values) {
    if (!cookie.startsWith(SESSION_COOKIE)) continue;
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
    const raw = pair.slice(SESSION_COOKIE.length);
    const expired = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0");
    if (expired || raw === "") return { kind: "cleared" };
    try {
      return { kind: "set", value: decodeURIComponent(raw) };
    } catch {
      return { kind: "cleared" };
    }
  }
  return null;
}

export interface Forwarded {
  /** O que a página recebe: nunca leva `set-cookie`. */
  response: Response;
  /** Mudança de sessão pedida pelo escritório (login, convite ou logout). */
  auth: AuthChange | null;
  /** O escritório recusou a sessão que mandamos: ela acabou. */
  unauthorized: boolean;
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

function failed(response: Response): Forwarded {
  return { response, auth: null, unauthorized: false };
}

function userNameFrom(body: ArrayBuffer): string | null {
  try {
    const name = (JSON.parse(new TextDecoder().decode(body)) as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** Repassa o pedido da página ao escritório aberto, com a sessão como Bearer. A origem vem sempre do `target`, nunca do pedido. */
export async function forwardToOffice(target: ForwardTarget, request: Request, fetchImpl: typeof fetch = fetch): Promise<Forwarded> {
  const incoming = new URL(request.url);
  const url = new URL(target.url);
  url.pathname = incoming.pathname;
  url.search = incoming.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  if (target.session !== null) headers.set("authorization", `Bearer ${target.session}`);

  let upstream: Response;
  let body: ArrayBuffer;
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    upstream = await fetchImpl(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    body = await upstream.arrayBuffer();
  } catch {
    return failed(jsonError(BAD_GATEWAY, `não consegui falar com ${url.host}; confira a internet ou a VPN e tente de novo`));
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return failed(jsonError(BAD_GATEWAY, "o escritório respondeu com um redirecionamento; confira o endereço"));
  }

  const cookie = sessionFromSetCookie(upstream.headers.getSetCookie());
  let auth: AuthChange | null = null;
  if (cookie?.kind === "set") {
    const isJson = upstream.ok && (upstream.headers.get("content-type") ?? "").includes("json");
    auth = { session: cookie.value, userName: isJson ? userNameFrom(body) : null };
  } else if (cookie?.kind === "cleared") {
    auth = { session: null, userName: null };
  }

  const pageHeaders = new Headers();
  for (const name of PAGE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) pageHeaders.set(name, value);
  }
  return {
    response: new Response(upstream.status === 204 ? null : body, { status: upstream.status, headers: pageHeaders }),
    auth,
    unauthorized: upstream.status === 401 && target.session !== null,
  };
}

/** O escritório responde? Só pergunta `/api/health`, sem sessão. */
export async function checkReachable(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL("/api/health", url), { redirect: "manual", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}
