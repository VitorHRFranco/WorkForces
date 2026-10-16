import type { WhoAmI } from "@workforces/protocol";
import { ConfigError, configDir, loadConfig, saveConfig, type Config } from "../config.js";
import type { MainContext } from "../main.js";
import { ServerUrlError, bridgeSocketUrl } from "../net/agent-connection.js";
import { readSecret } from "./secret-input.js";

const fail = (ctx: MainContext, message: string, code: number) => {
  ctx.io.stderr.write(`workforces: ${message}\n`);
  return code;
};

function load(ctx: MainContext): { dir: string; config: Config } | { error: string } {
  const dir = configDir(ctx.env);
  try {
    return { dir, config: loadConfig(dir) };
  } catch (error) {
    if (error instanceof ConfigError) return { error: error.message };
    throw error;
  }
}

export async function runLogin(args: string[], ctx: MainContext): Promise<number> {
  const insecure = args.includes("--insecure");
  const positional = args.filter((arg) => arg !== "--insecure");
  if (positional.length !== 1) return fail(ctx, "uso: workforces login <url> [--insecure]", 2);
  const input = positional[0]!;
  try {
    bridgeSocketUrl(input, insecure);
  } catch (error) {
    if (error instanceof ServerUrlError) return fail(ctx, error.message, 2);
    throw error;
  }
  const server = new URL(input).origin;
  const loaded = load(ctx);
  if ("error" in loaded) return fail(ctx, loaded.error, 2);

  let token: string;
  try {
    token = (await readSecret("Token da ponte (crie no escritório, em \"Tokens da ponte\"): ", ctx.io)).trim();
  } catch {
    return fail(ctx, "login cancelado", 1);
  }
  if (!token.startsWith("wf_")) return fail(ctx, "isso não parece um token da ponte (ele começa com wf_)", 2);

  let response: Response;
  try {
    response = await fetch(`${server}/api/bridge/whoami`, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    return fail(ctx, `não consegui falar com ${server}: ${(error as Error).message}`, 1);
  }
  if (response.status === 401) return fail(ctx, "token recusado pelo servidor", 1);
  if (!response.ok) return fail(ctx, `o servidor respondeu ${response.status}`, 1);
  const who = (await response.json()) as WhoAmI;

  saveConfig(loaded.dir, { ...loaded.config, server, token, insecure });
  ctx.io.stdout.write(`conectado ao escritório como ${who.name}\n`);
  return 0;
}

export function runLogout(ctx: MainContext): number {
  const loaded = load(ctx);
  if ("error" in loaded) return fail(ctx, loaded.error, 2);
  const { server: _server, token: _token, ...rest } = loaded.config;
  saveConfig(loaded.dir, { ...rest, insecure: false });
  ctx.io.stdout.write("login esquecido nesta máquina\n");
  return 0;
}
