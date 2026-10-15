import { randomUUID } from "node:crypto";
import { resolveClaude } from "./claude/resolve.js";
import { runDirect, runInPty, shouldUsePty, type Connector, type WrapperIO } from "./claude/wrapper.js";
import { ConfigError, configDir, labelFor, loadConfig, type Config } from "./config.js";
import { fileLogger } from "./log.js";
import { compileExtraPatterns } from "./masking/mask.js";
import { BUILTIN_PATTERNS } from "./masking/patterns.js";
import { AgentConnection, ServerUrlError, bridgeSocketUrl } from "./net/agent-connection.js";

const USAGE = `uso: escritorio <comando>

comandos:
  claude [args…]   roda o Claude Code espelhando o terminal no escritório
`;

export interface MainContext {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  io: WrapperIO;
  platform: NodeJS.Platform;
}

export async function main(ctx: MainContext): Promise<number> {
  const [command, ...rest] = ctx.argv;
  if (command === "claude") return runClaudeCommand(rest, ctx);
  if (command === undefined || command === "--help" || command === "-h") {
    ctx.io.stdout.write(USAGE);
    return 0;
  }
  ctx.io.stderr.write(`escritorio: comando desconhecido: ${command}\n${USAGE}`);
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
    ctx.io.stderr.write(`escritorio: ${err.message}\n`);
    return 2;
  }

  const resolved = resolveClaude(args, { env: ctx.env, platform: ctx.platform });
  if (!resolved) {
    ctx.io.stderr.write("escritorio: não encontrei o `claude` no PATH\n");
    return 127;
  }
  if (!shouldUsePty(ctx.io)) return runDirect(resolved, ctx.cwd, ctx.env);

  // Avisos só antes de abrir o Claude: depois disso, a ponte não escreve no terminal.
  const warnings: string[] = [];
  const patterns = [...BUILTIN_PATTERNS, ...compileExtraPatterns(config.secretPatterns, (message) => warnings.push(message))];
  let socketUrl: string | null = null;
  if (config.server && config.token) {
    try {
      socketUrl = bridgeSocketUrl(config.server, config.insecure);
    } catch (err) {
      if (!(err instanceof ServerUrlError)) throw err;
      warnings.push(`${err.message}; rodando sem espelhar`);
    }
  } else {
    warnings.push("sem login no escritório; rodando sem espelhar");
  }
  for (const warning of warnings) {
    ctx.io.stderr.write(`escritorio: ${warning}\n`);
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

  const code = await runInPty({ command: resolved, cwd: ctx.cwd, env: ctx.env, io: ctx.io, agentId, patterns, connect, log });
  if (state.fatal) ctx.io.stderr.write(`escritorio: ${state.fatal}\n`);
  return code;
}
