import type { Logger } from "./log.js";

const describe = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error));

/**
 * Durante a sessão do Claude, nada da ponte pode derrubar o processo nem escrever no terminal:
 * erros soltos e avisos do Node vão para o log. Os ouvintes anteriores voltam no fim.
 */
export async function withSessionGuard<T>(log: Logger, run: () => Promise<T>): Promise<T> {
  const onError = (error: unknown) => log(`erro inesperado na ponte: ${describe(error)}`);
  const onWarning = (warning: Error) => log(`aviso do Node: ${warning.message}`);
  const previousWarnings = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", onWarning);
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  try {
    return await run();
  } finally {
    process.removeListener("uncaughtException", onError);
    process.removeListener("unhandledRejection", onError);
    process.removeListener("warning", onWarning);
    for (const listener of previousWarnings) process.on("warning", listener);
  }
}
