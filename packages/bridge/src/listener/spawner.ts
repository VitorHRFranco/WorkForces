import { spawn } from "node:child_process";

/** Abre uma janela nova rodando `workforces claude` na pasta (spec 5.8). Linux e macOS entram depois, atrás desta interface. */
export interface Spawner {
  open(folder: string, alias: string): Promise<void>;
}

export class SpawnFailure extends Error {
  constructor(
    readonly reason: "no-terminal" | "spawn-failed",
    message: string,
  ) {
    super(message);
  }
}

export interface WindowCommandOptions {
  /** O node que roda a ponte (process.execPath). */
  node: string;
  /** O cli.js desta instalação da ponte. */
  cliPath: string;
  /** A pasta do config da ponte: o agente usa a mesma (a janela nova nem sempre herda as variáveis de ambiente). */
  home: string;
}

/** Os argumentos do `wt.exe`, sempre em array, sem montar string de shell. */
export function windowCommand(folder: string, alias: string, options: WindowCommandOptions): string[] {
  const args = ["-w", "new", "--title", `WorkForces: ${alias}`, "-d", folder, options.node, options.cliPath, "--home", options.home, "claude"];
  // O Windows Terminal usa ";" para separar comandos.
  if (args.some((arg) => arg.includes(";"))) throw new SpawnFailure("spawn-failed", "o Windows Terminal não aceita ; no caminho");
  return args;
}

/**
 * Abre a janela pelo Windows Terminal (`wt.exe`), que dá ao agente um terminal de verdade.
 * O conhost.exe não serve: aberto pelo Node, ele falha com acesso negado.
 */
export function windowsTerminalSpawner(options: WindowCommandOptions): Spawner {
  return {
    async open(folder, alias) {
      const args = windowCommand(folder, alias, options);
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
