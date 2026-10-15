// Programa falso usado nos testes no lugar do Claude Code.
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--once")) {
  process.stdout.write("uma-vez\n");
  process.exit(5);
}

const fakeToken = "ghp_" + "a".repeat(36);
process.stdout.write(`\x1b[1;32mOLÁ_DO_FALSO\x1b[0m token=${fakeToken}\r\n`);
process.stdout.write(`args=${args.map((arg) => arg.replaceAll(" ", "_")).join("|")}\r\n`);
process.stdout.write(`agent=${process.env.WORKFORCES_AGENT_ID ?? "-"}\r\n`);

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim() === "sair") process.exit(7);
  process.stdout.write(`eco:${line.trim()}\r\n`);
});
