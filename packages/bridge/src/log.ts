import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type Logger = (message: string) => void;

/** Log em arquivo. Nunca escreve no terminal e nunca derruba o invólucro. */
export function fileLogger(dir: string): Logger {
  const file = join(dir, "bridge.log");
  return (message) => {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // log é melhor esforço
    }
  };
}
