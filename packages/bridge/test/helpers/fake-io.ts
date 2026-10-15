import { PassThrough } from "node:stream";
import { stripAnsi } from "./ansi.js";
import { waitUntil } from "./wait.js";

/** stdin/stdout/stderr falsos (não-TTY) para rodar o invólucro dentro do teste. */
export function fakeIO(cols = 100, rows = 30) {
  const stdin = new PassThrough();
  const stdout = Object.assign(new PassThrough(), { columns: cols, rows });
  const stderr = new PassThrough();
  let output = "";
  let errors = "";
  stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString("utf8");
  });
  return {
    io: { stdin, stdout, stderr },
    type: (text: string) => stdin.write(text),
    output: () => stripAnsi(output),
    errors: () => errors,
    waitFor: (text: string, timeoutMs = 15_000) =>
      waitUntil(() => stripAnsi(output).includes(text), timeoutMs, `${text}\n--- saída ---\n${stripAnsi(output)}`),
  };
}
