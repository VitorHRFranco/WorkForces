#!/usr/bin/env node
import { main } from "./main.js";

// process.exit explícito: no Windows o node-pty mantém o processo vivo depois que o filho sai.
main({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), io: process, platform: process.platform }).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`workforces: erro inesperado: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
