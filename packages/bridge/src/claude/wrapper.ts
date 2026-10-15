import { spawn as spawnChild } from "node:child_process";
import nodePty from "@lydell/node-pty";
import type { MaskPattern } from "../masking/mask.js";
import { Mirror } from "../mirror/mirror.js";
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
  /** null = sem login: roda sem espelhar. */
  connect: Connector | null;
  /** Log em arquivo da ponte; nunca escreve no terminal. */
  log?: (message: string) => void;
}

export function shouldUsePty(io: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } }): boolean {
  return Boolean(io.stdin.isTTY && io.stdout.isTTY);
}

export function runInPty(options: PtyRunOptions): Promise<number> {
  const { io, command } = options;
  const cols = io.stdout.columns || 80;
  const rows = io.stdout.rows || 24;
  const ptyOptions = {
    name: "xterm-256color",
    cols,
    rows,
    cwd: options.cwd,
    env: { ...options.env, WORKFORCES_AGENT_ID: options.agentId },
  };
  const child = command.viaCmd
    ? nodePty.spawn(comspec(options.env), cmdArguments(command), ptyOptions)
    : nodePty.spawn(command.file, command.args, ptyOptions);

  let link: AgentLink | null = null;
  const mirror = new Mirror({
    cols,
    rows,
    patterns: options.patterns,
    send: (message) => link?.send(message) ?? false,
    onError: (error) => options.log?.(`erro no espelho: ${error instanceof Error ? error.message : String(error)}`),
  });
  link = options.connect?.({ cols, rows }, { onOpen: () => mirror.connectionOpened(), onViewers: (n) => mirror.setViewers(n) }) ?? null;
  mirror.start();

  // Caminho rápido primeiro; o espelho só recebe uma cópia.
  child.onData((data) => {
    io.stdout.write(data);
    mirror.write(data);
  });

  // Regra de entrada: o PTY só recebe o que vem do stdin local.
  const onInput = (chunk: string | Buffer) => child.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  if (io.stdin.isTTY) io.stdin.setRawMode?.(true);
  io.stdin.setEncoding("utf8");
  io.stdin.on("data", onInput);
  io.stdin.resume();

  const onResize = () => {
    const newCols = io.stdout.columns || cols;
    const newRows = io.stdout.rows || rows;
    child.resize(newCols, newRows);
    mirror.resize(newCols, newRows);
    link?.updateSize(newCols, newRows);
  };
  io.stdout.on("resize", onResize);

  return new Promise((resolve) => {
    child.onExit(({ exitCode }) => {
      io.stdout.removeListener("resize", onResize);
      io.stdin.removeListener("data", onInput);
      if (io.stdin.isTTY) io.stdin.setRawMode?.(false);
      io.stdin.pause();
      mirror.stop();
      link?.close();
      resolve(exitCode);
    });
  });
}

/** Sem terminal (pipes, scripts): roda o claude direto, sem PTY e sem espelhar. */
export function runDirect(command: ResolvedCommand, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  const child = command.viaCmd
    ? spawnChild(comspec(env), [cmdArguments(command)], { cwd, env, stdio: "inherit", windowsVerbatimArguments: true })
    : spawnChild(command.file, command.args, { cwd, env, stdio: "inherit" });
  return new Promise((resolve) => {
    child.on("error", () => resolve(127));
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
