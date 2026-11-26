import type { Logger } from "./logger.js";

let current: Logger | null = null;

/** O processo principal liga aqui o logger único, logo depois de fixar a pasta de dados. */
export function setMainLogger(logger: Logger): void {
  current = logger;
}

/**
 * O log do processo principal para os módulos que não recebem o logger por parâmetro. Antes de o logger existir (e nos
 * testes), cai no console.
 */
export const mainLog: Logger = {
  info: (source, message) => (current ? current.info(source, message) : console.info(`[${source}] ${message}`)),
  warn: (source, message) => (current ? current.warn(source, message) : console.warn(`[${source}] ${message}`)),
  error: (source, message, error) => {
    if (current) current.error(source, message, error);
    else if (error === undefined) console.error(`[${source}] ${message}`);
    else console.error(`[${source}] ${message}`, error);
  },
};

/**
 * "mensagem (motivo)": o aviso leva o motivo do erro no próprio texto. Com `cause` (o `fetch` do Node só diz "fetch
 * failed"; o motivo real, como ECONNREFUSED, vem nela), o motivo dela vai junto.
 */
export function withReason(message: string, error: unknown): string {
  const text = (value: unknown): string => (value instanceof Error ? value.message : String(value));
  const cause = error instanceof Error && error.cause !== undefined ? `: ${text(error.cause)}` : "";
  return `${message} (${text(error)}${cause})`;
}
