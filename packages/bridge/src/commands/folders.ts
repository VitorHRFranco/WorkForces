import { resolve } from "node:path";
import { ALIAS_PATTERN, MAX_ALIASES } from "@workforces/protocol";
import { ConfigError, configDir, folderKey, isDirectory, loadConfig, saveConfig, type Config } from "../config.js";
import type { MainContext } from "../main.js";

const USAGE = `uso:
  workforces pastas add <caminho> --nome <apelido>   libera a pasta para "Chamar agente" no escritório
  workforces pastas list                             mostra as pastas liberadas
  workforces pastas rm <apelido>                     tira a pasta da lista
`;

/** `workforces pastas`: a lista de pastas que o escritório pode pedir para abrir (o servidor só conhece os apelidos). */
export function runFolders(args: string[], ctx: MainContext): number {
  const fail = (message: string, code = 2) => {
    ctx.io.stderr.write(`workforces: ${message}\n`);
    return code;
  };
  const dir = configDir(ctx.env);
  let config: Config;
  try {
    config = loadConfig(dir);
  } catch (error) {
    if (error instanceof ConfigError) return fail(error.message);
    throw error;
  }
  const [command, ...rest] = args;

  if (command === "list" && rest.length === 0) {
    if (config.folders.length === 0) {
      ctx.io.stdout.write("nenhuma pasta liberada; use `workforces pastas add <caminho> --nome <apelido>`\n");
      return 0;
    }
    const width = Math.max(...config.folders.map((folder) => folder.alias.length));
    for (const folder of config.folders) {
      const missing = isDirectory(folder.path) ? "" : "  (não existe mais)";
      ctx.io.stdout.write(`${folder.alias.padEnd(width)}  ${folder.path}${missing}\n`);
    }
    return 0;
  }

  if (command === "rm" && rest.length === 1) {
    const alias = rest[0]!;
    if (!config.folders.some((folder) => folder.alias === alias)) return fail(`nenhuma pasta com o apelido ${alias}`, 1);
    saveConfig(dir, { ...config, folders: config.folders.filter((folder) => folder.alias !== alias) });
    ctx.io.stdout.write(`pasta ${alias} removida da lista\n`);
    return 0;
  }

  if (command === "add") {
    const nameAt = rest.indexOf("--nome");
    const alias = nameAt >= 0 ? rest[nameAt + 1] : undefined;
    const positional = rest.filter((_, index) => nameAt < 0 || (index !== nameAt && index !== nameAt + 1));
    if (alias === undefined || positional.length !== 1) return fail(`faltou o caminho ou o apelido\n${USAGE}`);
    const path = resolve(ctx.cwd, positional[0]!);
    if (!ALIAS_PATTERN.test(alias)) return fail("apelido inválido: use até 32 letras minúsculas, números e hífen, começando por letra ou número");
    if (!isDirectory(path)) return fail(`não é uma pasta: ${path}`);
    // O Windows Terminal usa ";" para separar comandos: a janela não abriria nessa pasta.
    if (path.includes(";")) return fail("o caminho não pode ter ; (o Windows Terminal não abre a pasta)");
    if (config.folders.some((folder) => folder.alias === alias)) return fail(`o apelido ${alias} já está em uso`);
    const same = config.folders.find((folder) => folderKey(folder.path, ctx.platform) === folderKey(path, ctx.platform));
    if (same) return fail(`essa pasta já está liberada como ${same.alias}`);
    if (config.folders.length >= MAX_ALIASES) return fail(`no máximo ${MAX_ALIASES} pastas`);
    saveConfig(dir, { ...config, folders: [...config.folders, { alias, path }] });
    ctx.io.stdout.write(`pasta liberada: ${alias} → ${path}\n`);
    return 0;
  }

  ctx.io.stderr.write(USAGE);
  return 2;
}
