import type { ApiErrorBody, InviteCreated, InviteStatus, Me, TokenCreated, TokenInfo } from "@workforces/protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "não consegui falar com o escritório";
}

/** Fora de GET, sempre JSON com corpo: o servidor exige application/json (proteção contra CSRF). O processo principal repassa sem Origin nem cookie, com a sessão como Bearer. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>;
  if (!response.ok) throw new ApiError(response.status, data.error ?? `erro ${response.status}`);
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  login: (name: string, password: string) => request<Me>("POST", "/api/login", { name, password }),
  logout: () => request<void>("POST", "/api/logout"),
  inviteStatus: (code: string) => request<InviteStatus>("GET", `/api/invites/${encodeURIComponent(code)}`),
  acceptInvite: (code: string, name: string, password: string) =>
    request<Me>("POST", `/api/invites/${encodeURIComponent(code)}/accept`, { name, password }),
  createInvite: () => request<InviteCreated>("POST", "/api/invites"),
  listTokens: () => request<TokenInfo[]>("GET", "/api/tokens"),
  createToken: (name: string) => request<TokenCreated>("POST", "/api/tokens", { name }),
  revokeToken: (id: number) => request<void>("DELETE", `/api/tokens/${id}`),
  /** O .tmj do escritório (o mesmo que o servidor usa para as mesas). */
  map: () => request<unknown>("GET", "/map/map.tmj"),
};
