import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { stripAnsi } from "./helpers/ansi.js";
import { waitUntil } from "./helpers/wait.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const cleanTempDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
};

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

const home = () => tempDir("wf-main-");

afterEach(cleanTempDirs);
const context = (argv: string[], env: NodeJS.ProcessEnv, io = bufferIO()) => ({
  ctx: { argv, env, cwd: process.cwd(), io: io.io, platform: process.platform },
  io,
});

describe("main", () => {
  it("sem argumentos mostra o uso", async () => {
    const { ctx, io } = context([], { WORKFORCES_HOME: home() });
    expect(await main(ctx)).toBe(0);
    expect(io.out()).toContain("workforces [--home <pasta>] <comando>");
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

  it("repete os avisos depois que o Claude sai", async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
    const stderr = new PassThrough();
    let out = "";
    let err = "";
    stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    const env = { ...process.env, WORKFORCES_HOME: home(), WORKFORCES_CLAUDE_BIN: process.execPath };
    const done = main({ argv: ["claude", FAKE], env, cwd: process.cwd(), io: { stdin, stdout, stderr }, platform: process.platform });
    await waitUntil(() => stripAnsi(out).includes("OLÁ_DO_FALSO"), 15_000, "saída do falso");
    stdin.write("sair\r");
    expect(await done).toBe(7);
    expect(err.split("sem login no escritório").length - 1).toBe(2);
  });

  it("avisa quando o login usa HTTP sem TLS (--insecure)", async () => {
    const dir = home();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ server: "http://127.0.0.2:9", token: "wf_" + "x".repeat(43), insecure: true }));
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
    const stderr = new PassThrough();
    let out = "";
    let err = "";
    stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    const env = { ...process.env, WORKFORCES_HOME: dir, WORKFORCES_CLAUDE_BIN: process.execPath };
    const done = main({ argv: ["claude", FAKE], env, cwd: process.cwd(), io: { stdin, stdout, stderr }, platform: process.platform });
    await waitUntil(() => stripAnsi(out).includes("OLÁ_DO_FALSO"), 15_000, "fake abriu");
    stdin.write("sair\r");
    expect(await done).toBe(7);
    expect(err.match(/sem TLS/g)?.length).toBe(2);
  });
});
