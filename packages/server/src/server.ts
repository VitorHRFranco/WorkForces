import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createAccountServices, type AccountServices } from "./accounts/index.js";
import { ADMIN_INVITE_TTL_MS } from "./accounts/invites.js";
import { buildApp } from "./app.js";
import { exposureWarning, type ServerConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { openDb } from "./db.js";
import { registerMapRoutes } from "./http/map-routes.js";
import { registerApi } from "./http/routes.js";
import { loadMap, type LoadedMap } from "./map/load-map.js";
import { Hub } from "./realtime/hub.js";
import { Listeners } from "./realtime/listeners.js";
import { World } from "./realtime/world.js";
import { registerSockets, type SocketOptions } from "./realtime/sockets.js";
import { registerClient } from "./static.js";

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
  listeners: Listeners;
  office: LoadedMap;
  world: World;
}

export function defaultLog(message: string): void {
  console.log(`[workforces] ${message}`);
}

/** Monta o servidor sem escutar a porta (os testes usam inject ou listen na porta 0). */
export function createServer(config: ServerConfig, options: CreateServerOptions = {}): WorkforcesServer {
  const office = loadMap(config.mapFile);
  let dbFile = options.dbFile;
  if (!dbFile) {
    mkdirSync(config.dataDir, { recursive: true });
    dbFile = join(config.dataDir, "workforces.db");
  }
  const db = openDb(dbFile);
  const ctx: AppContext = { config, now: options.now ?? Date.now, log: options.log ?? defaultLog };
  const accounts = createAccountServices(db, ctx.now);
  const world = new World(office.map, accounts.desks.owners(), accounts.desks.closedOwners());
  const hub = new Hub(
    options.graceMs,
    undefined,
    (viewerId, ownerId) => world.canWatch(viewerId, ownerId),
    (ownerId) => world.isClosed(ownerId),
  );
  const listeners = new Listeners();
  const app = buildApp(ctx);
  const onTokenRevoked = (tokenId: number) => {
    hub.closeBridgesForToken(tokenId);
    listeners.closeForToken(tokenId);
  };
  registerApi(app, { ctx, accounts, onTokenRevoked });
  registerSockets(app, { ctx, accounts, hub, world, listeners }, options.sockets);
  registerMapRoutes(app, office);
  registerClient(app, ctx);
  app.addHook("onClose", async () => db.close());
  return { app, ctx, accounts, hub, listeners, office, world };
}

/** Sobe o servidor; sem nenhuma conta, imprime um convite de admin (única vez em que um código vai para o log). */
export async function startServer(config: ServerConfig, options: CreateServerOptions = {}): Promise<WorkforcesServer> {
  const server = createServer(config, options);
  try {
    await server.app.listen({ port: config.port, host: config.host });
  } catch (error) {
    await server.app.close().catch(() => {});
    throw error;
  }
  const { log } = server.ctx;
  log(`escritório no ar em ${config.publicUrl.origin} (escutando em ${config.host}:${config.port})`);
  if (config.insecure) log("WF_INSECURE ligado: o tráfego pode não ter TLS");
  const exposure = exposureWarning(config);
  if (exposure) log(exposure);
  if (server.accounts.users.count() === 0) {
    const invite = server.accounts.invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS });
    log(`nenhuma conta ainda; convite de admin válido por 24 h: ${config.publicUrl.origin}/invite/${invite.code}`);
  }
  return server;
}
