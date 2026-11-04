import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { inviteAppLink } from "@workforces/protocol";
import { createAccountServices, type AccountServices } from "./accounts/index.js";
import { ADMIN_INVITE_TTL_MS } from "./accounts/invites.js";
import { buildApp } from "./app.js";
import { exposureWarning, type ServerConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { openDb } from "./db.js";
import { registerInvitePage } from "./http/invite-page.js";
import { registerMapRoutes } from "./http/map-routes.js";
import { registerApi } from "./http/routes.js";
import { loadMap, type LoadedMap } from "./map/load-map.js";
import { Hub } from "./realtime/hub.js";
import { World } from "./realtime/world.js";
import { loadOrCreateCertificate } from "./tls/certificate.js";
import { filePin, fixedPin, type PinSource } from "./tls/pin.js";
import { registerSockets, type SocketOptions } from "./realtime/sockets.js";

export interface CreateServerOptions {
  dbFile?: string;
  now?: () => number;
  log?: (message: string) => void;
  graceMs?: number;
  sockets?: SocketOptions;
  /** Recebe o código do convite de admin (a única forma de ele sair do servidor sem passar pelo log). */
  onAdminInvite?: (code: string) => void;
  /** Substitui o pino da configuração (os testes de rota usam um falso). */
  pin?: PinSource | null;
}

export interface WorkforcesServer {
  app: FastifyInstance;
  ctx: AppContext;
  accounts: AccountServices;
  hub: Hub;
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
  let https: { key: string; cert: string } | undefined;
  let pin: PinSource | null = null;
  if (config.tls === "self-signed") {
    const { cert, key } = loadOrCreateCertificate(join(config.dataDir, "tls"));
    https = { key, cert };
    pin = fixedPin(cert);
  } else if (config.pinFile) {
    pin = filePin(config.pinFile);
  }
  if (options.pin !== undefined) pin = options.pin;
  const ctx: AppContext = { config, now: options.now ?? Date.now, log: options.log ?? defaultLog, pin };
  const accounts = createAccountServices(db, ctx.now);
  const world = new World(office.map, accounts.desks.owners(), accounts.desks.closedOwners());
  const hub = new Hub(
    options.graceMs,
    undefined,
    (viewerId, ownerId) => world.canWatch(viewerId, ownerId),
    (ownerId) => world.isClosed(ownerId),
  );
  const app = buildApp(ctx, https);
  const onTokenRevoked = (tokenId: number) => hub.closeBridgesForToken(tokenId);
  registerApi(app, { ctx, accounts, onTokenRevoked });
  registerSockets(app, { ctx, accounts, hub, world }, options.sockets);
  registerMapRoutes(app, office);
  registerInvitePage(app, ctx);
  app.addHook("onClose", async () => db.close());
  return { app, ctx, accounts, hub, office, world };
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
    if (options.onAdminInvite) {
      options.onAdminInvite(invite.code);
    } else {
      const show = (pin: string | null) =>
        log(`nenhuma conta ainda; convite de admin válido por 24 h: ${pin ? inviteAppLink(config.publicUrl.origin, invite.code, pin) : `${config.publicUrl.origin}/invite/${invite.code}`}`);
      const { pin } = server.ctx;
      const first = pin?.current();
      if (!pin || first) {
        show(first?.pin ?? null);
      } else if (config.pinFile) {
        // O certificado da CA interna pode chegar depois do servidor: mostra o convite quando ele aparecer.
        log(`aguardando o certificado da rede interna em ${config.pinFile} para mostrar o convite de admin`);
        const timer = setInterval(() => {
          const ready = pin.current();
          if (!ready) return;
          clearInterval(timer);
          show(ready.pin);
        }, 2_000);
        timer.unref();
        // O Fastify não aceita hook depois de ouvir; o servidor HTTP emite "close" quando o app fecha.
        server.app.server.once("close", () => clearInterval(timer));
      }
    }
  }
  return server;
}
