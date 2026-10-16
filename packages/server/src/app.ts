import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";

export function buildApp(ctx: AppContext): FastifyInstance {
  // logger desligado: o do Fastify registraria URLs com códigos de convite.
  const app = Fastify({ logger: false, trustProxy: ctx.config.trustProxy, bodyLimit: 64 * 1024 });
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}
