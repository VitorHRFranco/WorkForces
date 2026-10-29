import { execFile, spawn } from "node:child_process";

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

function runDefault(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: RUN_TIMEOUT_MS }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

function versionAtLeast(version: string, min: number[]): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version.trim());
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > min[0]! || (major === min[0] && minor >= min[1]!);
}

/**
 * O Node do sistema que roda o invólucro: `WF_NODE`, ou o primeiro `node` do PATH. Precisa ser 22.12 ou mais novo.
 * Qualquer falha dá null (o app explica o que instalar).
 */
export async function findNode(
  env: NodeJS.ProcessEnv = process.env,
  run: (file: string, args: string[]) => Promise<string> = runDefault,
): Promise<string | null> {
  try {
    let node = env.WF_NODE;
    if (!node) {
      const found = (await run("where.exe", ["node"])).split(/\r?\n/).find((line) => line.trim() !== "");
      if (!found) return null;
      node = found.trim();
    }
    const version = await run(node, ["-p", "process.versions.node"]);
    return versionAtLeast(version, MIN_NODE) ? node : null;
  } catch {
    return null;
  }
}
