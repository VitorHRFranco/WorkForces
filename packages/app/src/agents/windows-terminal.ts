import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { posix, win32 } from "node:path";

/** Tudo o que a janela de um agente precisa; as credenciais não entram aqui (vão pelo canal local). */
export interface AgentWindow {
  folder: string;
  title: string;
  node: string;
  agentId: string;
  channelId: string;
}

/** Abre uma janela nova rodando `workforces claude` na pasta. Linux e macOS entram depois, atrás desta interface. */
export interface Spawner {
  open(window: AgentWindow): Promise<void>;
}

export class SpawnFailure extends Error {
  constructor(
    readonly reason: "no-terminal" | "spawn-failed",
    message: string,
  ) {
    super(message);
  }
}

/** O título único da janela: é por ele que o app a acha para minimizar. */
export function windowTitle(alias: string, agentId: string): string {
  return `WorkForces · ${alias} · ${agentId.slice(0, 8)}`;
}

/** Os argumentos do `wt.exe`, sempre em array, sem montar string de shell. */
export function windowCommand(window: AgentWindow, cliPath: string): string[] {
  const args = [
    "-w",
    "new",
    "--title",
    window.title,
    "--suppressApplicationTitle",
    "-d",
    window.folder,
    window.node,
    cliPath,
    "claude",
    "--agent-id",
    window.agentId,
    "--channel",
    window.channelId,
  ];
  // O Windows Terminal usa ";" para separar comandos.
  if (args.some((arg) => arg.includes(";"))) throw new SpawnFailure("spawn-failed", "o Windows Terminal não aceita ; no caminho");
  return args;
}

/**
 * Abre a janela pelo Windows Terminal (`wt.exe`), que dá ao agente um terminal de verdade.
 * O conhost.exe não serve: aberto pelo Node, ele falha com acesso negado.
 */
export function windowsTerminalSpawner(cliPath: string): Spawner {
  return {
    async open(window) {
      const args = windowCommand(window, cliPath);
      await new Promise<void>((resolve, reject) => {
        const child = spawn("wt.exe", args, { detached: true, stdio: "ignore" });
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
        child.once("error", (error: NodeJS.ErrnoException) => {
          reject(
            error.code === "ENOENT"
              ? new SpawnFailure("no-terminal", "não encontrei o Windows Terminal (wt.exe)")
              : new SpawnFailure("spawn-failed", error.message),
          );
        });
      });
    },
  };
}

const RUN_TIMEOUT_MS = 5_000;
const MIN_NODE = [22, 12];
/** Imprime o executável real e a versão: um atalho `node.exe` (Scoop, Volta) abre o Node de verdade como filho, e cada agente seria contado duas vezes. */
const PROBE = "process.stdout.write(process.execPath + '\\n' + process.versions.node)";

function runDefault(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: RUN_TIMEOUT_MS }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

function isFileDefault(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function versionAtLeast(version: string, min: number[]): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version.trim());
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > min[0]! || (major === min[0] && minor >= min[1]!);
}

/** Os caminhos de cada sistema pelo nome, e não pelos do processo: assim os testes dos dois valem em qualquer máquina. */
const pathsOf = (platform: NodeJS.Platform) => (platform === "win32" ? win32 : posix);

/** O primeiro `node.exe` (`node` fora do Windows) do PATH. A busca é feita aqui: o `where.exe` lista a pasta atual antes do PATH e escreve na página de código OEM (acento quebra). */
function nodeOnPath(env: NodeJS.ProcessEnv, exists: (path: string) => boolean, platform: NodeJS.Platform): string | null {
  const { delimiter, isAbsolute, join } = pathsOf(platform);
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path");
  const value = key === undefined ? undefined : env[key];
  if (!value) return null;
  const file = platform === "win32" ? "node.exe" : "node";
  for (const dir of value.split(delimiter)) {
    if (dir === "" || !isAbsolute(dir)) continue;
    const candidate = join(dir, file);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * O Node do sistema que roda o invólucro e o escritório hospedado: `WF_NODE`, ou o primeiro `node.exe` (`node` fora do
 * Windows) do PATH. Precisa ser 22.12 ou mais novo. Devolve o executável real, informado pelo próprio Node. Qualquer
 * falha dá null (o app explica o que instalar).
 */
export async function findNode(
  env: NodeJS.ProcessEnv = process.env,
  run: (file: string, args: string[]) => Promise<string> = runDefault,
  exists: (path: string) => boolean = isFileDefault,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  try {
    const candidate = env.WF_NODE || nodeOnPath(env, exists, platform);
    if (!candidate) return null;
    const lines = (await run(candidate, ["-e", PROBE])).split(/\r?\n/).map((line) => line.trim());
    if (lines.length !== 2 || lines[0] === "" || !pathsOf(platform).isAbsolute(lines[0]!)) return null;
    return versionAtLeast(lines[1]!, MIN_NODE) ? lines[0]! : null;
  } catch {
    return null;
  }
}
