import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createAccountServices, type AccountServices } from "./accounts/index.js";
import { buildApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { openDb } from "./db.js";
import { registerApi } from "./http/routes.js";
import { Hub } from "./realtime/hub.js";
import { registerSockets, type SocketOptions } from "./realtime/sockets.js";

export interface CreateServerOptions {
  dbFile?: string;
  now?: () => number;
  log?: (message: string) => void;
  graceMs?: number;
  sockets?: SocketOptions;
}

export interface WorkforcesServer {
  app: FastifyInstance;
  ctx: AppContext;
  accounts: AccountServices;
  hub: Hub;
}

export function defaultLog(message: string): void {
  console.log(`[workforces] ${message}`);
}

/** Monta o servidor sem escutar a porta (os testes usam inject ou listen na porta 0). */
export function createServer(config: ServerConfig, options: CreateServerOptions = {}): WorkforcesServer {
  let dbFile = options.dbFile;
  if (!dbFile) {
    mkdirSync(config.dataDir, { recursive: true });
    dbFile = join(config.dataDir, "workforces.db");
  }
  const db = openDb(dbFile);
  const ctx: AppContext = { config, now: options.now ?? Date.now, log: options.log ?? defaultLog };
  const accounts = createAccountServices(db, ctx.now);
  const hub = new Hub(options.graceMs);
  const app = buildApp(ctx);
  registerApi(app, { ctx, accounts, onTokenRevoked: (tokenId) => hub.closeBridgesForToken(tokenId) });
  registerSockets(app, { ctx, accounts, hub }, options.sockets);
  app.addHook("onClose", async () => db.close());
  return { app, ctx, accounts, hub };
}
