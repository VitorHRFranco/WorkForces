import type { WrapperIO } from "../claude/wrapper.js";

/** Lê um segredo sem ecoar no terminal; fora de terminal (scripts, testes), lê a primeira linha. */
export function readSecret(prompt: string, io: WrapperIO): Promise<string> {
  io.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const tty = Boolean(io.stdin.isTTY);
    let value = "";
    const finish = (error?: Error) => {
      io.stdin.removeListener("data", onData);
      io.stdin.removeListener("end", onEnd);
      if (tty) io.stdin.setRawMode?.(false);
      io.stdin.pause();
      io.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onEnd = () => finish();
    const onData = (chunk: string | Buffer) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("cancelado"));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    if (tty) io.stdin.setRawMode?.(true);
    io.stdin.setEncoding("utf8");
    io.stdin.on("data", onData);
    io.stdin.on("end", onEnd);
    io.stdin.resume();
  });
}
