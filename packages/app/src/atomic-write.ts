import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** No Windows, antivírus e indexador seguram o arquivo por instantes: a troca tenta de novo antes de desistir. */
const RENAME_RETRIES = 5;
const RENAME_WAIT_MS = 30;
const RENAME_BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Espera curta e síncrona (a gravação é síncrona); sem `Atomics.wait` permitido, espera ocupada. */
function pause(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // espera
    }
  }
}

export function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= RENAME_RETRIES || !RENAME_BUSY.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      pause(RENAME_WAIT_MS);
    }
  }
}

/** Grava `<arquivo>.tmp` e renomeia, para um corte no meio não deixar o arquivo pela metade. */
export function writeFileAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameWithRetry(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
