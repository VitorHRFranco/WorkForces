import { randomUUID } from "node:crypto";
import { runFolders } from "./commands/folders.js";
import { runLogin, runLogout } from "./commands/login.js";
import { resolveClaude } from "./claude/resolve.js";
import { withSessionGuard } from "./guard.js";
import { runDirect, runInPty, shouldUsePty, type Connector, type WrapperIO } from "./claude/wrapper.js";
import { ConfigError, configDir, labelFor, loadConfig, type Config } from "./config.js";
import { fileLogger } from "./log.js";
import { compileExtraPatterns } from "./masking/mask.js";
import { BUILTIN_PATTERNS } from "./masking/patterns.js";
import { AgentConnection, ServerUrlError, bridgeSocketUrl } from "./net/agent-connection.js";

const USAGE = `uso: workforces [--home <pasta>] <comando>

comandos:
  login <url> [--insecure]   conecta esta máquina ao escritório (pede o token da ponte)
  logout                     esquece o login desta máquina
  claude [args…]             roda o Claude Code espelhando o terminal no escritório
  pastas add|list|rm         pastas que o escritório pode abrir em "Chamar agente"

--home <pasta> usa outra pasta de config (o padrão é ~/.workforces).
`;

export interface MainContext {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  io: WrapperIO;
  platform: NodeJS.Platform;
}

export async function main(ctx: MainContext): Promise<number> {
  // --home troca a pasta do config só nesta execução.
  if (ctx.argv[0] === "--home") {
    const home = ctx.argv[1];
    if (!home) {
      ctx.io.stderr.write("workforces: --home precisa de uma pasta\n");
      return 2;
    }
    return main({ ...ctx, argv: ctx.argv.slice(2), env: { ...ctx.env, WORKFORCES_HOME: home } });
  }
  const [command, ...rest] = ctx.argv;
  if (command === "claude") return runClaudeCommand(rest, ctx);
  if (command === "login") return runLogin(rest, ctx);
  if (command === "logout") return runLogout(ctx);
  if (command === "pastas") return runFolders(rest, ctx);
  if (command === undefined || command === "--help" || command === "-h") {
    ctx.io.stdout.write(USAGE);
    return 0;
  }
  ctx.io.stderr.write(`workforces: comando desconhecido: ${command}\n${USAGE}`);
  return 2;
}

async function runClaudeCommand(args: string[], ctx: MainContext): Promise<number> {
  const dir = configDir(ctx.env);
  const log = fileLogger(dir);
  let config: Config;
  try {
    config = loadConfig(dir);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    ctx.io.stderr.write(`workforces: ${err.message}\n`);
    return 2;
  }

  const resolved = resolveClaude(args, { env: ctx.env, platform: ctx.platform });
  if (!resolved) {
    ctx.io.stderr.write("workforces: não encontrei o `claude` no PATH\n");
    return 127;
  }
  if (!shouldUsePty(ctx.io)) return runDirect(resolved, ctx.cwd, ctx.env);

  // Avisos antes de abrir o Claude e de novo depois que ele sai; durante a sessão, a ponte não escreve no terminal.
  const warnings: string[] = [];
  const patterns = [...BUILTIN_PATTERNS, ...compileExtraPatterns(config.secretPatterns, (message) => warnings.push(message))];
  let socketUrl: string | null = null;
  if (config.server && config.token) {
    try {
      socketUrl = bridgeSocketUrl(config.server, config.insecure);
      if (config.insecure && new URL(config.server).protocol === "http:") {
        warnings.push("conexão sem TLS (--insecure): o terminal espelhado trafega sem criptografia");
      }
    } catch (err) {
      if (!(err instanceof ServerUrlError)) throw err;
      warnings.push(`${err.message}; rodando sem espelhar`);
    }
  } else {
    warnings.push("sem login no escritório; rodando sem espelhar");
  }
  for (const warning of warnings) {
    ctx.io.stderr.write(`workforces: ${warning}\n`);
    log(warning);
  }

  const agentId = randomUUID();
  const label = labelFor(ctx.cwd, config.folders, ctx.platform);
  const state = { fatal: null as string | null };
  const url = socketUrl;
  const token = config.token;
  const connect: Connector | null =
    url && token
      ? (size, events) => {
          const connection = new AgentConnection({
            url,
            token,
            hello: { agentId, label, ...size },
            log,
            handlers: {
              ...events,
              onFatal: (message) => {
                state.fatal = message;
                log(message);
              },
            },
          });
          connection.start();
          return connection;
        }
      : null;

  const code = await withSessionGuard(log, () =>
    runInPty({ command: resolved, cwd: ctx.cwd, env: ctx.env, io: ctx.io, agentId, patterns, connect, log }),
  );
  // No Windows o ConPTY limpa a tela ao iniciar e apaga os avisos: repete-os ao sair.
  for (const warning of warnings) ctx.io.stderr.write(`workforces: ${warning}\n`);
  if (state.fatal) ctx.io.stderr.write(`workforces: ${state.fatal}\n`);
  return code;
}
