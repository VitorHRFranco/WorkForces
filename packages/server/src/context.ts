import type { ServerConfig } from "./config.js";

export interface AppContext {
  config: ServerConfig;
  now: () => number;
  /** Nunca recebe conteúdo de quadros, senhas, tokens, ids de sessão nem códigos de convite. */
  log: (message: string) => void;
}
