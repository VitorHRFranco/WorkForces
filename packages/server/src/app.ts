import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppContext } from "./context.js";

/** Erros que o próprio Fastify gera (JSON quebrado, corpo grande demais, 403 do static…), no formato das outras respostas. */
const ERROR_TEXT: Record<number, string> = {
  400: "pedido inválido",
  403: "acesso negado",
  404: "não encontrado",
  413: "pedido grande demais",
  415: "use application/json",
};

export function buildApp(ctx: AppContext): FastifyInstance {
  // logger desligado: o do Fastify registraria URLs com códigos de convite.
  // trustProxy: confia só no proxy imediatamente à frente (1 salto).
  const options: FastifyServerOptions = { logger: false, trustProxy: ctx.config.trustProxy ? (_address, hop) => hop < 1 : false, bodyLimit: 64 * 1024 };
  const app = Fastify(options);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    // Com o logger desligado, sem isto um erro interno sumiria. Vai o padrão da rota, nunca a URL (pode ter código de convite).
    if (status === 500) ctx.log(`erro interno em ${request.method} ${request.routeOptions.url ?? "(sem rota)"}: ${error.message}`);
    return reply.code(status).send({ error: ERROR_TEXT[status] ?? (status === 500 ? "erro interno do servidor" : "pedido inválido") });
  });
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}
