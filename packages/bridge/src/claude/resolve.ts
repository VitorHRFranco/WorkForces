import { statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface ResolvedCommand {
  /** O executável, ou o script .cmd/.bat quando `viaCmd`. */
  file: string;
  args: string[];
  /** true quando é um script .cmd/.bat, que precisa do cmd.exe. */
  viaCmd: boolean;
}

export interface ResolveOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  isFile?: (path: string) => boolean;
}

/** Lê uma variável de ambiente sem diferenciar maiúsculas (no Windows, PATH costuma vir como "Path"). */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function defaultIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const isScript = (path: string) => /\.(cmd|bat)$/i.test(path);

export function resolveClaude(userArgs: string[], options: ResolveOptions): ResolvedCommand | null {
  const windows = options.platform === "win32";
  const isFile = options.isFile ?? defaultIsFile;
  const override = envValue(options.env, "WORKFORCES_CLAUDE_BIN");
  if (override) return { file: override, args: userArgs, viaCmd: windows && isScript(override) };

  const join = windows ? win32.join : posix.join;
  const dirs = (envValue(options.env, "PATH") ?? "").split(windows ? ";" : ":").filter(Boolean);
  const extensions = windows
    ? (envValue(options.env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `claude${extension.toLowerCase()}`);
      if (isFile(candidate)) return { file: candidate, args: userArgs, viaCmd: windows && isScript(candidate) };
    }
  }
  return null;
}

const SAFE_CMD_ARG = /^[A-Za-z0-9_\-.:\\/=@,+]+$/;

/** Aspas no estilo do cmd.exe. Os argumentos vêm do próprio dono; `%` não é escapado. */
export function quoteForCmd(arg: string): string {
  return SAFE_CMD_ARG.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

/** Argumentos para `cmd.exe`: com /s, o cmd remove só as aspas de fora e roda o resto como está. */
export function cmdArguments(command: ResolvedCommand): string {
  const inner = [command.file, ...command.args].map(quoteForCmd).join(" ");
  return `/d /s /c "${inner}"`;
}

export function comspec(env: NodeJS.ProcessEnv): string {
  return envValue(env, "COMSPEC") ?? "cmd.exe";
}
