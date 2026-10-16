import { USER_NAME_PATTERN } from "@workforces/protocol";
import { z } from "zod";
import { ConfigError, configDir, loadConfig, saveConfig, type Config } from "../config.js";
import type { MainContext } from "../main.js";
import { ServerUrlError, bridgeSocketUrl } from "../net/agent-connection.js";
import { readSecret } from "./secret-input.js";

const WhoAmIResponse = z.object({ name: z.string().regex(USER_NAME_PATTERN) });

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
  if (input.startsWith("wf_")) {
    return fail(ctx, "o token não vai na linha de comando: rode `workforces login <url>` e cole o token quando ele for pedido", 2);
  }
  if (input.includes("@")) return fail(ctx, "tire o usuário e a senha da URL do servidor", 2);
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
    response = await fetch(`${server}/api/bridge/whoami`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    if ((error as Error).name === "TimeoutError") return fail(ctx, `o servidor ${server} não respondeu em 15 s`, 1);
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return fail(ctx, `não consegui falar com ${server}: ${cause?.code ?? cause?.message ?? (error as Error).message}`, 1);
  }
  if (response.status >= 300 && response.status < 400) {
    try {
      const origin = new URL(response.headers.get("location") ?? "", server).origin;
      if (origin !== server) return fail(ctx, `o servidor redirecionou para ${origin}; rode o login com esse endereço`, 1);
      return fail(ctx, "o servidor respondeu com um redirecionamento", 1);
    } catch {
      return fail(ctx, "o servidor respondeu com um redirecionamento", 1);
    }
  }
  if (response.status === 401) return fail(ctx, "token recusado pelo servidor", 1);
  if (!response.ok) return fail(ctx, `o servidor respondeu ${response.status}`, 1);
  const who = WhoAmIResponse.safeParse(await response.json().catch(() => null));
  if (!who.success) return fail(ctx, `a resposta de ${server} não parece de um escritório WorkForces`, 1);

  try {
    saveConfig(loaded.dir, { ...loaded.config, server, token, insecure });
  } catch (error) {
    return fail(ctx, `não consegui gravar o config: ${(error as Error).message}`, 1);
  }
  ctx.io.stdout.write(`conectado ao escritório como ${who.data.name}\n`);
  return 0;
}

export function runLogout(ctx: MainContext): number {
  const loaded = load(ctx);
  if ("error" in loaded) return fail(ctx, loaded.error, 2);
  const { server: _server, token: _token, ...rest } = loaded.config;
  try {
    saveConfig(loaded.dir, { ...rest, insecure: false });
  } catch (error) {
    return fail(ctx, `não consegui gravar o config: ${(error as Error).message}`, 1);
  }
  ctx.io.stdout.write("login esquecido nesta máquina\n");
  return 0;
}
