#!/usr/bin/env node
import { runServerCli } from "./server-cli.js";

runServerCli(process.argv.slice(2), process.env, { log: (m) => console.log(m), error: (m) => console.error(m) }).then(
  (code) => {
    if (code !== null) process.exit(code);
  },
  (error: unknown) => {
    console.error(`workforces-server: erro inesperado: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  },
);
