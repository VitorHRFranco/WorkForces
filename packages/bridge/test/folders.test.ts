import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { main } from "../src/main.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function bufferIO() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  return { io: { stdin: new PassThrough(), stdout, stderr }, out: () => out, err: () => err };
}

/** Roda `workforces <args>` com o config em `home`, a partir de `cwd`. */
async function run(home: string, args: string[], cwd = process.cwd(), platform: NodeJS.Platform = process.platform) {
  const io = bufferIO();
  const code = await main({ argv: args, env: { WORKFORCES_HOME: home }, cwd, io: io.io, platform });
  return { code, out: io.out(), err: io.err() };
}

describe("workforces pastas", () => {
  it("add com caminho relativo grava o caminho absoluto; list mostra; rm tira", async () => {
    const home = tempDir("wf-home-");
    const projects = tempDir("wf-proj-");
    mkdirSync(join(projects, "loja"));
    const added = await run(home, ["pastas", "add", "loja", "--nome", "loja"], projects);
    expect(added.code).toBe(0);
    expect(added.out).toContain(`loja → ${join(projects, "loja")}`);
    expect(loadConfig(home).folders).toEqual([{ alias: "loja", path: join(projects, "loja") }]);
    expect((await run(home, ["pastas", "list"])).out).toContain(join(projects, "loja"));
    rmSync(join(projects, "loja"), { recursive: true });
    expect((await run(home, ["pastas", "list"])).out).toContain("(não existe mais)");
    expect((await run(home, ["pastas", "rm", "loja"])).code).toBe(0);
    expect(loadConfig(home).folders).toEqual([]);
    expect((await run(home, ["pastas", "list"])).out).toContain("nenhuma pasta liberada");
    expect((await run(home, ["pastas", "rm", "loja"])).code).toBe(1);
  });

  it("recusa apelido inválido ou repetido, caminho que não é pasta, pasta repetida e caminho com ;", async () => {
    const home = tempDir("wf-home-");
    const projects = tempDir("wf-proj-");
    mkdirSync(join(projects, "loja"));
    mkdirSync(join(projects, "a;b"));
    writeFileSync(join(projects, "arquivo.txt"), "x");
    expect((await run(home, ["pastas", "add", "loja", "--nome", "Loja"], projects)).err).toContain("apelido inválido");
    expect((await run(home, ["pastas", "add", "nao-existe", "--nome", "x"], projects)).err).toContain("não é uma pasta");
    expect((await run(home, ["pastas", "add", "arquivo.txt", "--nome", "x"], projects)).err).toContain("não é uma pasta");
    expect((await run(home, ["pastas", "add", "a;b", "--nome", "ab"], projects)).err).toContain(";");
    expect((await run(home, ["pastas", "add", "loja", "--nome", "loja"], projects)).code).toBe(0);
    expect((await run(home, ["pastas", "add", "loja", "--nome", "outra"], projects)).err).toContain("já está liberada como loja");
    mkdirSync(join(projects, "site"));
    expect((await run(home, ["pastas", "add", "site", "--nome", "loja"], projects)).err).toContain("já está em uso");
    expect((await run(home, ["pastas", "add", "--nome", "x"], projects)).code).toBe(2);
    expect(loadConfig(home).folders.map((folder) => folder.alias)).toEqual(["loja"]);
  });

  it("no Windows, a mesma pasta com outras maiúsculas é repetida", async () => {
    const home = tempDir("wf-home-");
    const projects = tempDir("wf-proj-");
    mkdirSync(join(projects, "loja"));
    expect((await run(home, ["pastas", "add", "loja", "--nome", "loja"], projects, "win32")).code).toBe(0);
    const same = await run(home, ["pastas", "add", join(projects, "loja").toUpperCase(), "--nome", "outra"], projects, "win32");
    // Fora do Windows o caminho em maiúsculas não existe; no Windows é a mesma pasta.
    expect(same.err).toMatch(process.platform === "win32" ? /já está liberada como loja/ : /não é uma pasta/);
  });

  it("regravar o config mantém as chaves que esta versão não conhece", async () => {
    const home = tempDir("wf-home-");
    const projects = tempDir("wf-proj-");
    mkdirSync(join(projects, "loja"));
    writeFileSync(join(home, "config.json"), JSON.stringify({ server: "http://localhost:4600", futuro: { ligado: true } }));
    expect((await run(home, ["pastas", "add", "loja", "--nome", "loja"], projects)).code).toBe(0);
    const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(saved.futuro).toEqual({ ligado: true });
    expect(saved.server).toBe("http://localhost:4600");
  });

  it("--home troca a pasta do config só nesta execução", async () => {
    const home = tempDir("wf-home-");
    const other = tempDir("wf-outra-");
    const projects = tempDir("wf-proj-");
    mkdirSync(join(projects, "loja"));
    expect((await run(home, ["--home", other, "pastas", "add", "loja", "--nome", "loja"], projects)).code).toBe(0);
    expect(loadConfig(other).folders).toHaveLength(1);
    expect(loadConfig(home).folders).toHaveLength(0);
    expect((await run(home, ["--home"])).code).toBe(2);
  });
});
