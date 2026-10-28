import { forwardToOffice, jsonError } from "../net/forward.js";
import type { AuthChange, ForwardTarget } from "../state.js";
import { servePageFile } from "./files.js";

export const PAGE_HOST = "workforces";

export interface PageHandlerDeps {
  clientDir: string;
  /** O escritório aberto agora, ou null. */
  target(): ForwardTarget | null;
  onAuth(change: AuthChange): void;
  onUnauthorized(): void;
  fetchImpl?: typeof fetch;
}

/** O que atende `app://workforces/`: `/api` e `/map` vão ao escritório aberto, o resto é arquivo da página. */
export function createPageHandler(deps: PageHandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== PAGE_HOST) return new Response(null, { status: 404 });

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/map/")) {
      const target = deps.target();
      if (target === null) return jsonError(409, "nenhum escritório aberto");
      const forwarded = await forwardToOffice(target, request, deps.fetchImpl);
      if (forwarded.auth !== null) deps.onAuth(forwarded.auth);
      if (forwarded.unauthorized) deps.onUnauthorized();
      return forwarded.response;
    }
    return servePageFile(deps.clientDir, url.pathname, request.method);
  };
}
