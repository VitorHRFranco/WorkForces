import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAccountServices, disableUser } from "./accounts/index.js";
import { ServerConfigError, loadServerConfig, type ServerConfig } from "./config.js";
import { openDb } from "./db.js";
import { startServer } from "./server.js";

export interface CliOutput {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = `uso: workforces-server <comando>

comandos:
  start                 sobe o escritório (configuração pelas variáveis WF_*)
  user disable <nome>   desativa uma conta e derruba as conexões dela
`;

/** Devolve o código de saída, ou null quando o servidor fica rodando. */
export async function runServerCli(args: string[], env: NodeJS.ProcessEnv, out: CliOutput): Promise<number | null> {
  const [command, ...rest] = args;
  const isStart = command === "start" && rest.length === 0;
  const isDisable = command === "user" && rest[0] === "disable" && rest.length === 2;
  if (!isStart && !isDisable) {
    if (command) {
      out.error(USAGE);
      return 2;
    }
    out.log(USAGE);
    return 0;
  }

  let config: ServerConfig;
  try {
    config = loadServerConfig(env);
  } catch (error) {
    if (!(error instanceof ServerConfigError)) throw error;
    out.error(`workforces-server: ${error.message}`);
    return 2;
  }

  if (isStart) {
    const server = await startServer(config, { log: (message) => out.log(`[workforces] ${message}`) });
    const stop = () => void server.app.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return null;
  }
  return disableByName(join(config.dataDir, "workforces.db"), rest[1]!, out);
}

function disableByName(dbFile: string, name: string, out: CliOutput): number {
  if (!existsSync(dbFile)) {
    out.error(`workforces-server: banco não encontrado em ${dbFile}`);
    return 1;
  }
  const db = openDb(dbFile);
  try {
    const accounts = createAccountServices(db, Date.now);
    const user = accounts.users.byNameIncludingDisabled(name);
    if (!user) {
      out.error(`workforces-server: conta não encontrada: ${name}`);
      return 1;
    }
    disableUser(accounts, user.id);
    out.log(`conta ${user.name} desativada; conexões abertas caem em até 30 s`);
    return 0;
  } finally {
    db.close();
  }
}
