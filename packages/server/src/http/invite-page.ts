import { INVITE_CODE_PATTERN, inviteAppLink } from "@workforces/protocol";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export const APP_DOWNLOAD_URL = "https://github.com/VitorHRFranco/WorkForces/releases/latest";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function pageHtml(origin: string, host: string, code: string): string {
  const link = escapeHtml(inviteAppLink(origin, code));
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Convite para o WorkForces</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1b1d23; color: #e8e9ee; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  main { max-width: 32rem; margin: 1rem; padding: 1.5rem; background: #262932; border-radius: 8px; }
  a.open { display: inline-block; padding: 0.6rem 1.2rem; background: #4f7cff; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; }
  a { color: #8fb0ff; }
  code { word-break: break-all; }
</style>
</head>
<body>
<main>
<h1>Convite para o WorkForces</h1>
<p>Este convite abre o app do WorkForces, onde você cria sua conta no escritório <strong>${escapeHtml(host)}</strong>.</p>
<p><a class="open" href="${link}">Abrir no WorkForces</a></p>
<p>Ainda não tem o app? <a href="${escapeHtml(APP_DOWNLOAD_URL)}">Baixe o instalador</a>, instale e clique de novo em "Abrir no WorkForces".</p>
<p>Se o app não abrir, copie este link e cole em "Entrar com convite": <code>${escapeHtml(`${origin}/invite/${code}`)}</code></p>
</main>
<script>location.href = document.querySelector("a.open").href;</script>
</body>
</html>
`;
}

/** Página do link de convite (não consulta nem gasta o convite) e o 404 em JSON para tudo o que não é rota. */
export function registerInvitePage(app: FastifyInstance, ctx: AppContext): void {
  const notFound = { error: "não encontrado" };
  app.get<{ Params: { code: string } }>("/invite/:code", (request, reply) => {
    const { code } = request.params;
    if (!INVITE_CODE_PATTERN.test(code)) return reply.code(404).send(notFound);
    const { origin, host } = ctx.config.publicUrl;
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      )
      .send(pageHtml(origin, host, code));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(notFound));
}
