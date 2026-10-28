import type { AuthChange, ForwardTarget } from "../state.js";

const SESSION_COOKIE = "wf_session=";
const FORWARD_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 3_000;
const BAD_GATEWAY = 502;
const NOT_FOUND = 404;
/** A resposta repassada tem a origem da página: sem isto, um HTML vindo do escritório rodaria com os poderes dela. */
const ISOLATION_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } as const;
/** Valores de sessão aceitos: ASCII visível, para nunca quebrar o cabeçalho `Authorization` (no HTTP e no WebSocket). */
const SESSION_VALUE = /^[!-~]+$/;
const FORWARDED_PATHS = ["/api/", "/map/"] as const;
/** Só o que a página precisa ler da resposta; o resto (e sobretudo o `set-cookie`) fica no processo principal. */
const PAGE_RESPONSE_HEADERS = ["content-type", "cache-control"] as const;
/** Teto da resposta repassada: o mapa e a API cabem com folga; mais que isso só enche a memória do processo principal. */
export const MAX_FORWARD_BYTES = 8 * 1024 * 1024;
/** Erros do TLS do Node que dizem que o certificado do escritório não é confiável (e não que a rede caiu). */
const CERTIFICATE_ERRORS = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** O `wf_session` de um `Set-Cookie`: `set` com o valor, `cleared` se foi apagado, `null` se o cookie não veio. */
export function sessionFromSetCookie(values: readonly string[]): { kind: "set"; value: string } | { kind: "cleared" } | null {
  for (const cookie of values) {
    if (!cookie.startsWith(SESSION_COOKIE)) continue;
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
    const raw = pair.slice(SESSION_COOKIE.length);
    const expired = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0");
    if (expired || raw === "") return { kind: "cleared" };
    try {
      const value = decodeURIComponent(raw);
      return SESSION_VALUE.test(value) ? { kind: "set", value } : null;
    } catch {
      return null;
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
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", ...ISOLATION_HEADERS } });
}

function failed(response: Response): Forwarded {
  return { response, auth: null, unauthorized: false };
}

const fieldOf = (value: unknown, field: "code" | "cause"): unknown => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[field] : undefined);

/** O `fetch` do Node embrulha o erro do TLS em `cause`; o código diz se o problema é o certificado, e não a rede. */
function isCertificateError(error: unknown): boolean {
  return [fieldOf(error, "code"), fieldOf(fieldOf(error, "cause"), "code")].some(
    (code) => typeof code === "string" && (CERTIFICATE_ERRORS.has(code) || code.startsWith("CERT_")),
  );
}

/** Lê o corpo até o teto; null se passar dele (pelo `content-length` ou pelo que chegou de fato). */
async function readCapped(response: Response, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > max) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (response.body === null) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
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
  if (!FORWARDED_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return failed(jsonError(NOT_FOUND, "caminho não encontrado"));

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  if (target.session !== null) headers.set("authorization", `Bearer ${target.session}`);

  let upstream: Response;
  let body: ArrayBuffer | null;
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    upstream = await fetchImpl(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    body = await readCapped(upstream, MAX_FORWARD_BYTES);
  } catch (error) {
    if (isCertificateError(error)) {
      return failed(jsonError(BAD_GATEWAY, `o certificado de ${url.host} não é confiável neste computador; peça a quem administra o escritório o certificado da rede interna`));
    }
    return failed(jsonError(BAD_GATEWAY, `não consegui falar com ${url.host}; confira a internet ou a VPN e tente de novo`));
  }
  if (body === null) {
    return failed(jsonError(BAD_GATEWAY, "o escritório mandou uma resposta grande demais; tente de novo e, se repetir, avise quem cuida do escritório"));
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return failed(jsonError(BAD_GATEWAY, "o escritório respondeu com um redirecionamento; confira o endereço"));
  }
  // Estes status não cabem num `Response`; a página recebe um erro em vez de uma exceção.
  if (upstream.status < 200 || upstream.status > 599 || upstream.status === 205) {
    return failed(jsonError(BAD_GATEWAY, `${url.host} respondeu algo que o app não entende; tente de novo e, se repetir, avise quem cuida do escritório`));
  }

  const cookie = sessionFromSetCookie(upstream.headers.getSetCookie());
  let auth: AuthChange | null = null;
  if (cookie?.kind === "set") {
    const isJson = upstream.ok && (upstream.headers.get("content-type") ?? "").includes("json");
    auth = { session: cookie.value, userName: isJson ? userNameFrom(body) : null };
  } else if (cookie?.kind === "cleared") {
    auth = { session: null, userName: null };
  }

  const pageHeaders = new Headers(ISOLATION_HEADERS);
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
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
