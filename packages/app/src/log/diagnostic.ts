import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redact } from "./redact.js";

export interface DiagnosticInput {
  header: string[];
  logDir: string;
  bridgeLog: string | null;
  bridgeTailBytes?: number;
}

/** O log da ponte, no mesmo lugar que o `configDir` dela. */
export function bridgeLogPath(): string {
  return join(process.env.WORKFORCES_HOME ?? join(homedir(), ".workforces"), "bridge.log");
}

function readTail(path: string, bytes: number): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** O texto do diagnóstico: cabeçalho, logs do app (do mais antigo ao mais novo) e o fim do log da ponte, tudo mascarado. */
export function buildDiagnostic(input: DiagnosticInput): string {
  const parts: string[] = [input.header.join("\n")];
  let any = false;
  for (let index = 4; index >= 0; index--) {
    const name = index === 0 ? "app.log" : `app.${index}.log`;
    const path = join(input.logDir, name);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8");
      parts.push(`===== ${name} =====\n${content}`);
      any = true;
    } catch {
      // arquivo ilegível: segue sem ele
    }
  }
  if (!any) parts.push("(sem log)");
  const bridge = input.bridgeLog === null ? null : readTail(input.bridgeLog, input.bridgeTailBytes ?? 200_000);
  parts.push(`===== bridge.log (fim) =====\n${bridge ?? "(a ponte ainda não gravou log)"}`);
  return redact(parts.join("\n\n"));
}
