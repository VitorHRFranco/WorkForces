import { LIMITS } from "@workforces/protocol";
import { z } from "zod";
import { LocalChannel, channelPath, isChannelId } from "./channel/index.js";
import { resolveClaude } from "./claude/resolve.js";
import { runDirect, shouldUsePty, startPty, type WrapperIO } from "./claude/wrapper.js";
import { configDir } from "./config.js";
import { withSessionGuard } from "./guard.js";
import { fileLogger } from "./log.js";
import { compileExtraPatterns } from "./masking/mask.js";
import { BUILTIN_PATTERNS } from "./masking/patterns.js";
import { AgentConnection, ServerUrlError, bridgeSocketUrl } from "./net/agent-connection.js";

const USAGE = `uso: workforces claude --agent-id <uuid> --channel <id> [args do claude…]

Comando interno: o app do WorkForces roda este comando ao chamar um agente.
O endereço do escritório e o token da ponte chegam pelo canal local, nunca pela linha de comando.
Para abrir um agente, use "Chamar agente" no app.
`;

const NEEDS_APP = 'workforces: abra o agente pelo app do WorkForces ("Chamar agente")\n';

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
  ctx.io.stderr.write(`workforces: comando desconhecido: ${command}\n${USAGE}`);
  return 2;
}

interface ClaudeArgs {
  agentId: string;
  channel: string;
  /** O resto vai para o Claude. */
  claudeArgs: string[];
}

/** `--agent-id <uuid> --channel <id>` no começo, em qualquer ordem; null se faltar, repetir ou for inválido. */
function parseClaudeArgs(args: string[]): ClaudeArgs | null {
  const found = new Map<string, string>();
  let i = 0;
  while (args[i] === "--agent-id" || args[i] === "--channel") {
    const flag = args[i]!;
    const value = args[i + 1];
    if (value === undefined || found.has(flag)) return null;
    found.set(flag, value);
    i += 2;
  }
  const agentId = found.get("--agent-id");
  const channel = found.get("--channel");
  if (!agentId || !z.uuid().safeParse(agentId).success || !channel || !isChannelId(channel)) return null;
  return { agentId, channel, claudeArgs: args.slice(i) };
}

async function runClaudeCommand(args: string[], ctx: MainContext): Promise<number> {
  const parsed = parseClaudeArgs(args);
  if (!parsed) {
    ctx.io.stderr.write(NEEDS_APP);
    return 2;
  }
  const { agentId } = parsed;
  const log = fileLogger(configDir(ctx.env));

  const resolved = resolveClaude(parsed.claudeArgs, { env: ctx.env, platform: ctx.platform });
  if (!resolved) {
    ctx.io.stderr.write("workforces: não encontrei o `claude` no PATH\n");
    return 127;
  }
  if (!shouldUsePty(ctx.io)) return runDirect(resolved, ctx.cwd, ctx.env);

  // Durante a sessão, a ponte não escreve no terminal: os avisos vão para o log e aparecem depois que o Claude sai.
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    log(message);
  };
  const state = { fatal: null as string | null };

  const code = await withSessionGuard(log, async () => {
    let channel: LocalChannel | null = null;
    // Só os padrões embutidos até o app mandar os extras no `start`.
    const session = startPty({
      command: resolved,
      cwd: ctx.cwd,
      env: ctx.env,
      io: ctx.io,
      agentId,
      patterns: BUILTIN_PATTERNS,
      local: (message) => channel?.send(message) ?? false,
      log,
    });

    let label: string | null = null;
    let office: string | null = null;
    const candidate = new LocalChannel(
      channelPath(parsed.channel),
      {
        // As credenciais do escritório só chegam por aqui (nunca pela linha de comando nem por arquivo).
        onStart: (start) => {
          label = start.label;
          office = start.server;
          let url: string;
          try {
            url = bridgeSocketUrl(start.server);
          } catch (err) {
            if (!(err instanceof ServerUrlError)) throw err;
            warn(`${err.message}; rodando sem espelhar`);
            return;
          }
          const extra = compileExtraPatterns(start.secretPatterns, warn);
          session.connect((size, events) => {
            const connection = new AgentConnection({
              url,
              token: start.token,
              anchor: start.anchor ?? null,
              hello: { agentId, label: start.label, ...size },
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
          }, extra);
        },
        onInput: (data) => session.input(data),
        onWatch: (on) => session.watchLocal(on),
        info: () => {
          const size = session.size();
          return {
            agentId,
            label,
            office,
            cols: Math.max(1, Math.min(size.cols, LIMITS.maxCols)),
            rows: Math.max(1, Math.min(size.rows, LIMITS.maxRows)),
            state: session.state(),
          };
        },
      },
      log,
    );
    try {
      await candidate.listen();
      channel = candidate;
    } catch (err) {
      warn(`não consegui abrir o canal com o app (${err instanceof Error ? err.message : String(err)}); rodando sem espelhar`);
    }

    try {
      return await session.exit;
    } finally {
      await channel?.close();
    }
  });
  // No Windows o ConPTY limpa a tela ao iniciar: os avisos só aparecem ao sair.
  for (const warning of warnings) ctx.io.stderr.write(`workforces: ${warning}\n`);
  if (state.fatal) ctx.io.stderr.write(`workforces: ${state.fatal}\n`);
  return code;
}
