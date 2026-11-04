import type { ServerConfig } from "./config.js";
import type { PinSource } from "./tls/pin.js";

export interface AppContext {
  config: ServerConfig;
  now: () => number;
  /** Nunca recebe conteúdo de quadros, senhas, tokens, ids de sessão nem códigos de convite. */
  log: (message: string) => void;
  /** O pino do certificado que vai nos convites; `null` quando o endereço não usa certificado próprio nem de CA interna. */
  pin: PinSource | null;
}
