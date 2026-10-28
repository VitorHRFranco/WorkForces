import { fileURLToPath } from "node:url";
import type { LightMyRequestResponse } from "fastify";
import { createAccountServices, type AccountServices } from "../../src/accounts/index.js";
import { ADMIN_INVITE_TTL_MS, INVITE_TTL_MS } from "../../src/accounts/invites.js";
import type { User } from "../../src/accounts/users.js";
import { buildApp } from "../../src/app.js";
import type { ServerConfig } from "../../src/config.js";
import type { AppContext } from "../../src/context.js";
import { openDb } from "../../src/db.js";
import { registerApi } from "../../src/http/routes.js";
import { loadMap } from "../../src/map/load-map.js";

export const ORIGIN = "http://localhost:4600";
/** O mapa do repositório (assets/map/office.tmj). */
export const REPO_MAP = fileURLToPath(new URL("../../../../assets/map/office.tmj", import.meta.url));
/** O mapa do repositório já conferido (8 mesas, `mesa-1` a `mesa-8`). */
export const officeMap = () => loadMap(REPO_MAP).map;
export const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN };

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    publicUrl: new URL(ORIGIN),
    dataDir: "",
    mapFile: REPO_MAP,
    insecure: false,
    trustProxy: false,
    ...overrides,
  };
}

export async function setupApi(config: ServerConfig = testConfig()) {
  const clock = { now: 1_700_000_000_000 };
  const logs: string[] = [];
  const ctx: AppContext = { config, now: () => clock.now, log: (message) => logs.push(message) };
  const accounts = createAccountServices(openDb(":memory:"), ctx.now);
  const revoked: number[] = [];
  const app = buildApp(ctx);
  registerApi(app, { ctx, accounts, onTokenRevoked: (id) => revoked.push(id) });
  await app.ready();
  return { app, ctx, accounts, clock, logs, revoked };
}

export async function createUser(accounts: AccountServices, name: string, options: { admin?: boolean; password?: string } = {}): Promise<User> {
  const { code } = accounts.invites.create({
    createdBy: null,
    isAdmin: options.admin ?? false,
    ttlMs: options.admin ? ADMIN_INVITE_TTL_MS : INVITE_TTL_MS,
  });
  const result = await accounts.invites.accept(code, name, options.password ?? "senha-forte-123");
  if (!result.ok) throw new Error(`não criou ${name}: ${result.reason}`);
  return result.user;
}

/** "wf_session=..." da resposta, para mandar de volta no cabeçalho cookie. */
export function cookieOf(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("sem set-cookie");
  return value.split(";")[0]!;
}

/** O id da sessão (o valor do cookie), para mandar como Bearer, como o app faz. */
export function sessionOf(response: LightMyRequestResponse): string {
  return decodeURIComponent(cookieOf(response).slice("wf_session=".length));
}
