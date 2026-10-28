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

    // `app:` não é um esquema especial: a barra invertida não vira `/` aqui, mas viraria no `https:` do escritório.
    if (/\\|%5c/i.test(url.pathname)) return new Response(null, { status: 404 });

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/map/")) {
      const target = deps.target();
      if (target === null) return jsonError(409, "nenhum escritório aberto");
      const forwarded = await forwardToOffice(target, request, deps.fetchImpl);
      // Se outro escritório ou outra conta (no mesmo endereço) abriu enquanto este respondia, a sessão e o 401 não são
      // dela. Login, logout, a renovação do /api/me e o 401 passam: a sessão não muda entre o pedido e a resposta.
      const now = deps.target();
      if (now?.url === target.url && now.session === target.session) {
        try {
          if (forwarded.auth !== null) deps.onAuth(forwarded.auth);
          if (forwarded.unauthorized) deps.onUnauthorized();
        } catch (error) {
          // Gravar o perfil falhou (antivírus segurando o arquivo): a sessão já vale na memória, e a resposta do escritório chega à página.
          console.warn("não consegui guardar a sessão do escritório", error);
        }
      }
      return forwarded.response;
    }
    return servePageFile(deps.clientDir, url.pathname, request.method);
  };
}
