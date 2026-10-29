import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import nodePty from "@lydell/node-pty";
import type { AgentState } from "@workforces/protocol";
import type { MaskPattern } from "../masking/mask.js";
import { Mirror, type MirrorMessage } from "../mirror/mirror.js";
import type { AgentLink, LinkEvents } from "../net/agent-connection.js";
import { cmdArguments, comspec, type ResolvedCommand } from "./resolve.js";

export interface WrapperIO {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  stdout: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };
  stderr: NodeJS.WritableStream;
}

/** Cria a conexão com o servidor para um agente. */
export type Connector = (size: { cols: number; rows: number }, events: LinkEvents) => AgentLink;

export interface PtyRunOptions {
  command: ResolvedCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  io: WrapperIO;
  agentId: string;
  patterns: readonly MaskPattern[];
  /** Envia ao painel do app pelo canal local; devolve false se a mensagem foi descartada. */
  local: (message: MirrorMessage) => boolean;
  /** Log em arquivo da ponte; nunca escreve no terminal. */
  log?: (message: string) => void;
}

/** O Claude rodando num PTY. Até o `connect`, nada vai ao escritório. */
export interface PtySession {
  readonly exit: Promise<number>;
  /** Liga o espelho ao escritório; só a primeira chamada vale. */
  connect(connector: Connector, extraPatterns: readonly MaskPattern[]): void;
  /** Teclas vindas do painel do app (canal local). */
  input(data: string): void;
  /** Liga ou desliga os quadros para o painel do app. */
  watchLocal(on: boolean): void;
  size(): { cols: number; rows: number };
  state(): AgentState;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function shouldUsePty(io: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } }): boolean {
  return Boolean(io.stdin.isTTY && io.stdout.isTTY);
}

export function startPty(options: PtyRunOptions): PtySession {
  const { io, command } = options;
  let cols = io.stdout.columns || 80;
  let rows = io.stdout.rows || 24;
  const ptyOptions = {
    name: options.env.TERM ?? "xterm-256color",
    cols,
    rows,
    cwd: options.cwd,
    env: { ...options.env, WORKFORCES_AGENT_ID: options.agentId },
  };
  const child = command.viaCmd
    ? nodePty.spawn(comspec(options.env), cmdArguments(command), ptyOptions)
    : nodePty.spawn(command.file, command.args, ptyOptions);

  let link: AgentLink | null = null;
  let connected = false;
  let exited = false;
  const mirror = new Mirror({
    cols,
    rows,
    patterns: options.patterns,
    send: (message) => link?.send(message) ?? false,
    local: options.local,
    onError: (error) => options.log?.(`erro no espelho: ${errorMessage(error)}`),
  });
  mirror.start();

  // Caminho rápido primeiro; o espelho só recebe uma cópia.
  child.onData((data) => {
    io.stdout.write(data);
    mirror.write(data);
  });

  // Regra de entrada: o PTY só recebe o stdin local e a digitação do painel do app, pelo canal local do mesmo usuário.
  const onInput = (chunk: string | Buffer) => child.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  if (io.stdin.isTTY) io.stdin.setRawMode?.(true);
  io.stdin.setEncoding("utf8");
  io.stdin.on("data", onInput);
  io.stdin.resume();

  const onResize = () => {
    try {
      const newCols = io.stdout.columns || cols;
      const newRows = io.stdout.rows || rows;
      child.resize(newCols, newRows);
      cols = newCols;
      rows = newRows;
      mirror.resize(newCols, newRows);
      link?.updateSize(newCols, newRows);
    } catch (error) {
      options.log?.(`erro ao redimensionar: ${errorMessage(error)}`);
    }
  };
  io.stdout.on("resize", onResize);

  const exit = new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      exited = true;
      try {
        io.stdout.removeListener("resize", onResize);
        io.stdin.removeListener("data", onInput);
        if (io.stdin.isTTY) io.stdin.setRawMode?.(false);
        io.stdin.pause();
      } catch (error) {
        options.log?.(`erro ao restaurar o terminal: ${errorMessage(error)}`);
      }
      try {
        mirror.stop();
        link?.close();
      } catch (error) {
        options.log?.(`erro ao encerrar: ${errorMessage(error)}`);
      } finally {
        resolve(exitCode);
      }
    });
  });

  return {
    exit,
    connect(connector, extraPatterns) {
      if (connected || exited) return;
      connected = true;
      // Os padrões extras entram antes da conexão: nenhum quadro sai ao escritório sem eles.
      mirror.addPatterns(extraPatterns);
      try {
        link = connector({ cols, rows }, { onOpen: () => mirror.connectionOpened(), onViewers: (n) => mirror.setViewers(n) });
      } catch (error) {
        options.log?.(`não consegui conectar ao escritório: ${errorMessage(error)}`);
        link = null;
      }
    },
    input(data) {
      if (exited) return;
      try {
        child.write(data);
      } catch (error) {
        options.log?.(`erro ao repassar a digitação do painel: ${errorMessage(error)}`);
      }
    },
    watchLocal: (on) => mirror.setLocalWatching(on),
    size: () => ({ cols, rows }),
    state: () => mirror.state,
  };
}

/** Sem terminal (pipes, scripts): roda o claude direto, sem PTY e sem espelhar. */
export function runDirect(command: ResolvedCommand, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  // Ctrl+C/Ctrl+Break: o filho recebe o sinal do console e decide; o invólucro só repassa o código dele.
  const ignoreSignal = (): void => {};
  process.on("SIGINT", ignoreSignal);
  process.on("SIGBREAK", ignoreSignal);
  const release = (): void => {
    process.removeListener("SIGINT", ignoreSignal);
    process.removeListener("SIGBREAK", ignoreSignal);
  };
  let child: ChildProcess;
  try {
    child = command.viaCmd
      ? spawnChild(comspec(env), [cmdArguments(command)], { cwd, env, stdio: "inherit", windowsVerbatimArguments: true })
      : spawnChild(command.file, command.args, { cwd, env, stdio: "inherit" });
  } catch (error) {
    release();
    throw error;
  }
  return new Promise((resolve) => {
    child.on("error", () => {
      release();
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      release();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
