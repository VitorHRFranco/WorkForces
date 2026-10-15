import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

function bufferIO() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  return { io: { stdin: new PassThrough(), stdout, stderr }, out: () => out, err: () => err };
}

const home = () => mkdtempSync(join(tmpdir(), "wf-main-"));
const context = (argv: string[], env: NodeJS.ProcessEnv, io = bufferIO()) => ({
  ctx: { argv, env, cwd: process.cwd(), io: io.io, platform: process.platform },
  io,
});

describe("main", () => {
  it("sem argumentos mostra o uso", async () => {
    const { ctx, io } = context([], { WORKFORCES_HOME: home() });
    expect(await main(ctx)).toBe(0);
    expect(io.out()).toContain("escritorio <comando>");
  });

  it("comando desconhecido devolve 2", async () => {
    const { ctx, io } = context(["voar"], { WORKFORCES_HOME: home() });
    expect(await main(ctx)).toBe(2);
    expect(io.err()).toContain("comando desconhecido: voar");
  });

  it("claude fora do PATH devolve 127", async () => {
    const { ctx, io } = context(["claude"], { WORKFORCES_HOME: home(), PATH: home() });
    expect(await main(ctx)).toBe(127);
    expect(io.err()).toContain("não encontrei o `claude`");
  });

  it("config inválido devolve 2", async () => {
    const dir = home();
    writeFileSync(join(dir, "config.json"), "{");
    const { ctx, io } = context(["claude"], { WORKFORCES_HOME: dir, WORKFORCES_CLAUDE_BIN: process.execPath });
    expect(await main(ctx)).toBe(2);
    expect(io.err()).toContain("não é um JSON válido");
  });

  it("sem terminal roda o claude direto e repassa o código", async () => {
    const env = { ...process.env, WORKFORCES_HOME: home(), WORKFORCES_CLAUDE_BIN: process.execPath };
    const { ctx } = context(["claude", FAKE, "--once"], env);
    expect(await main(ctx)).toBe(5);
  });
});
