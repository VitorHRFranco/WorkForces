import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";

const BROWSER_METHODS = new Set(["GET", "HEAD"]);
const isServerPath = (path: string) => ["/api", "/ws"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/** Serve o build do cliente; rotas do navegador (ex.: /login, /invite/…) recebem index.html. */
export function registerClient(app: FastifyInstance, ctx: AppContext): void {
  const dir = ctx.config.clientDir;
  const available = existsSync(join(dir, "index.html"));
  if (available) void app.register(fastifyStatic, { root: dir, dotfiles: "ignore" });
  else ctx.log(`cliente web não encontrado em ${dir}; rode \`pnpm build\``);

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (available && BROWSER_METHODS.has(request.method) && !isServerPath(path)) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "não encontrado" });
  });
}
