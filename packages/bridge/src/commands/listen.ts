import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpawnError } from "@workforces/protocol";
import { ConfigError, configDir, isDirectory, loadConfig, type Config } from "../config.js";
import { SpawnHandler } from "../listener/handler.js";
import { countOpenAgents } from "../listener/open-agents.js";
import { windowsTerminalSpawner, type Spawner } from "../listener/spawner.js";
import { fileLogger } from "../log.js";
import type { MainContext } from "../main.js";
import { ServerUrlError, bridgeSocketUrl } from "../net/bridge-socket.js";
import { ListenerConnection } from "../net/listener-connection.js";

/** O cli.js desta instalação (dist/commands/listen.js → dist/cli.js): é ele que a janela nova roda. */
const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

const REASONS: Record<SpawnError, string> = {
  "no-listener": "a ponte não está ligada",
  "unknown-alias": "essa pasta não está liberada",
  "folder-missing": "a pasta não existe mais",
  "rate-limited": "pedido cedo demais (no máximo um a cada 5 s)",
  "too-many-agents": "já há 5 agentes abertos neste computador",
  "no-terminal": "o Windows Terminal não está instalado (winget install Microsoft.WindowsTerminal)",
  "spawn-failed": "não consegui abrir a janela (detalhes no bridge.log)",
  unsupported: "abrir agente pelo escritório só funciona no Windows por enquanto",
  timeout: "a resposta demorou demais",
};

export interface ListenerOptions {
  /** Nos testes: abre a "janela" sem o Windows Terminal. */
  spawner?: Spawner;
  countOpenAgents?: () => Promise<number>;
  now?: () => number;
  /** Encerra a ponte (nos testes); fora deles, Ctrl+C. */
  signal?: AbortSignal;
  /** Espera depois de uma mudança no config antes de reler (o arquivo é regravado em etapas). */
  debounceMs?: number;
}

/** `workforces ponte`: fica ligada, anuncia as pastas liberadas e atende "Chamar agente" (spec 5.8). */
export async function runListener(ctx: MainContext, options: ListenerOptions = {}): Promise<number> {
  const out = (line: string) => ctx.io.stdout.write(`${line}\n`);
  const fail = (message: string) => {
    ctx.io.stderr.write(`workforces: ${message}\n`);
    return 2;
  };
  const dir = configDir(ctx.env);
  let config: Config;
  try {
    config = loadConfig(dir);
  } catch (error) {
    if (error instanceof ConfigError) return fail(error.message);
    throw error;
  }
  const { server, token } = config;
  if (!server || !token) return fail("sem login no escritório: rode `workforces login <url>`");
  let url: string;
  try {
    url = bridgeSocketUrl(server, config.insecure);
  } catch (error) {
    if (error instanceof ServerUrlError) return fail(error.message);
    throw error;
  }
  let spawner = options.spawner;
  if (!spawner) {
    if (ctx.platform !== "win32") return fail("abrir agente pelo escritório só funciona no Windows por enquanto");
    spawner = windowsTerminalSpawner({ node: process.execPath, cliPath: CLI_PATH, home: resolve(dir) });
  }

  const log = fileLogger(dir);
  const handler = new SpawnHandler({
    folders: () => config.folders,
    isDirectory,
    countOpenAgents: options.countOpenAgents ?? (() => countOpenAgents(CLI_PATH)),
    spawner,
    now: options.now ?? Date.now,
    log,
  });
  const aliasesOf = (current: Config) => current.folders.map((folder) => folder.alias);
  const describe = (aliases: string[]) =>
    aliases.length > 0 ? `pastas liberadas: ${aliases.join(", ")}` : "nenhuma pasta liberada (use `workforces pastas add <caminho> --nome <apelido>`)";

  return new Promise<number>((done) => {
    let finished = false;
    let reloadTimer: NodeJS.Timeout | null = null;
    let watcher: FSWatcher | null = null;

    const connection = new ListenerConnection({
      url,
      token,
      log,
      aliases: aliasesOf(config),
      onOpen: () => out(`conectada ao escritório ${server}; ${describe(aliasesOf(config))}`),
      onDrop: () => out("sem conexão com o escritório; tentando de novo…"),
      onSpawn: (reqId, alias) => {
        void handler.handle(alias).then((outcome) => {
          if (outcome.ok) out(`abrindo agente em ${alias} (${outcome.folder})`);
          else out(`pedido recusado (${alias}): ${REASONS[outcome.error]}`);
          connection.sendResult(reqId, outcome.ok, outcome.ok ? undefined : outcome.error);
        });
      },
      onFatal: (message) => {
        ctx.io.stderr.write(`workforces: ${message}\n`);
        finish(1);
      },
    });

    // Só as pastas valem na hora; trocar servidor ou token pede para reiniciar a ponte.
    const reload = () => {
      reloadTimer = null;
      let next: Config;
      try {
        next = loadConfig(dir);
      } catch (error) {
        out(`config inválido; mantendo as pastas anteriores (${(error as Error).message})`);
        return;
      }
      const before = aliasesOf(config).join("\n");
      config = { ...config, folders: next.folders };
      if (aliasesOf(config).join("\n") === before) return;
      connection.updateAliases(aliasesOf(config));
      out(describe(aliasesOf(config)));
    };

    const onStop = () => finish(0);
    function finish(code: number): void {
      if (finished) return;
      finished = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      watcher?.close();
      connection.close();
      process.removeListener("SIGINT", onStop);
      process.removeListener("SIGBREAK", onStop);
      options.signal?.removeEventListener("abort", onStop);
      done(code);
    }

    watcher = watch(dir, (_event, file) => {
      if (file !== null && file !== "config.json") return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reload, options.debounceMs ?? 300);
    });
    watcher.on("error", (error) => log(`não consigo mais observar o config: ${error.message}`));
    process.on("SIGINT", onStop);
    process.on("SIGBREAK", onStop);
    options.signal?.addEventListener("abort", onStop);
    out("workforces ponte: ligada (Ctrl+C para sair)");
    connection.start();
  });
}
