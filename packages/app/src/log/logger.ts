import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.js";

export type LogLevel = "info" | "aviso" | "erro";

export interface Logger {
  info(source: string, message: string): void;
  warn(source: string, message: string): void;
  error(source: string, message: string, error?: unknown): void;
}

export interface LoggerOptions {
  dir: string;
  maxBytes?: number;
  files?: number;
  now?: () => Date;
  echo?: (line: string) => void;
}

function fileName(index: number): string {
  return index === 0 ? "app.log" : `app.${index}.log`;
}

/** Log em arquivo com rotação e sem segredos. Nunca lança: erro de disco é engolido. */
export function createLogger(options: LoggerOptions): Logger {
  const { dir } = options;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const files = Math.max(1, options.files ?? 5);
  const now = options.now ?? (() => new Date());
  const echo = options.echo ?? ((line: string) => console.log(line));

  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // sem pasta, as gravações abaixo também falham e são engolidas
  }

  function rotateIfNeeded(): void {
    let size: number;
    try {
      size = statSync(join(dir, fileName(0))).size;
    } catch {
      return;
    }
    if (size <= maxBytes) return;
    // Cada passo tem o seu try: um arquivo travado (EPERM no Windows) não pode impedir a gravação.
    try {
      rmSync(join(dir, fileName(files - 1)), { force: true });
    } catch {
      // segue com a rotação
    }
    for (let i = files - 2; i >= 0; i--) {
      try {
        renameSync(join(dir, fileName(i)), join(dir, fileName(i + 1)));
      } catch {
        // arquivo ausente ou travado: segue
      }
    }
  }

  function write(level: LogLevel, source: string, message: string, error?: unknown): void {
    let text = `${now().toISOString()} ${level} [${source}] ${message}`;
    if (error !== undefined) {
      const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
      text += "\n" + detail.split("\n").map((l) => `  ${l}`).join("\n");
    }
    const line = redact(text);
    try {
      echo(line);
    } catch {
      // o eco nunca derruba o app
    }
    try {
      rotateIfNeeded();
      appendFileSync(join(dir, fileName(0)), line + "\n");
    } catch {
      // disco cheio, sem permissão etc.: o log é só diagnóstico
    }
  }

  return {
    info: (source, message) => write("info", source, message),
    warn: (source, message) => write("aviso", source, message),
    error: (source, message, error) => write("erro", source, message, error),
  };
}
