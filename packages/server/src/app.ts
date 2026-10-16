import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppContext } from "./context.js";

export function buildApp(ctx: AppContext): FastifyInstance {
  // logger desligado: o do Fastify registraria URLs com códigos de convite.
  // trustProxy: confia só no proxy imediatamente à frente (1 salto).
  const options: FastifyServerOptions = { logger: false, trustProxy: ctx.config.trustProxy ? (_address, hop) => hop < 1 : false, bodyLimit: 64 * 1024 };
  const app = Fastify(options);
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}
