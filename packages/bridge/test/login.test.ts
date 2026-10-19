import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const cleanTempDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
};

const TOKEN = "wf_" + "t".repeat(43);
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  cleanTempDirs();
});

async function whoamiServer(host = "127.0.0.1", mode: "ok" | "html" | "redirect" = "ok"): Promise<string> {
  const server = createServer((request, response) => {
    if (mode === "html" && request.url === "/api/bridge/whoami") {
      response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><p>login</p>");
      return;
    }
    if (mode === "redirect") {
      response.writeHead(302, { location: "http://127.0.0.1:9/qualquer" }).end();
      return;
    }
    if (request.url === "/api/bridge/whoami" && request.headers.authorization === `Bearer ${TOKEN}`) {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "ana" }));
      return;
    }
    response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "token inválido" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

function run(argv: string[], home: string, input = "") {
  const stdin = new PassThrough();
  stdin.end(input);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  const done = main({ argv, env: { WORKFORCES_HOME: home }, cwd: home, io: { stdin, stdout, stderr }, platform: process.platform });
  return done.then((code) => ({ code, out, err }));
}

const home = () => tempDir("wf-login-");
const readConfig = (dir: string) => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<string, unknown>;

describe("workforces login", () => {
  it("valida o token, salva servidor e token e mantém o resto do config", async () => {
    const url = await whoamiServer();
    const dir = home();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ folders: [{ alias: "loja", path: "/tmp/loja" }], secretPatterns: ["X-[0-9]+"] }));
    const result = await run(["login", `${url}/qualquer/caminho`], dir, `${TOKEN}\n`);
    expect(result.code).toBe(0);
    expect(result.out).toContain("conectado ao escritório como ana");
    expect(result.out).not.toContain(TOKEN);
    expect(readConfig(dir)).toEqual({
      server: url,
      token: TOKEN,
      insecure: false,
      folders: [{ alias: "loja", path: "/tmp/loja" }],
      secretPatterns: ["X-[0-9]+"],
    });
  });

  it("token recusado não altera o config", async () => {
    const url = await whoamiServer();
    const dir = home();
    const result = await run(["login", url], dir, "wf_errado\n");
    expect(result.code).toBe(1);
    expect(result.err).toContain("token recusado");
    expect(() => readConfig(dir)).toThrow();
  });

  it("HTTP fora de localhost exige --insecure", async () => {
    const url = await whoamiServer("127.0.0.2");
    const dir = home();
    const refused = await run(["login", url], dir, `${TOKEN}\n`);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("HTTP sem TLS");
    const accepted = await run(["login", url, "--insecure"], dir, `${TOKEN}\n`);
    expect(accepted.code).toBe(0);
    expect(readConfig(dir)).toMatchObject({ server: url, insecure: true });
  });

  it("recusa texto que não parece token e servidor fora do ar", async () => {
    const dir = home();
    const notToken = await run(["login", "http://127.0.0.1:1"], dir, "abc\n");
    expect(notToken.code).toBe(2);
    expect(notToken.err).toContain("não parece um token");
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const free = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const offline = await run(["login", free], dir, `${TOKEN}\n`);
    expect(offline.code).toBe(1);
    expect(offline.err).toContain(`não consegui falar com ${free}`);
    expect(offline.err).toContain("ECONNREFUSED");
  });

  it("resposta que não é do escritório não salva nada", async () => {
    const url = await whoamiServer("127.0.0.1", "html");
    const dir = home();
    const result = await run(["login", url], dir, `${TOKEN}\n`);
    expect(result.code).toBe(1);
    expect(result.err).toContain("não parece de um escritório");
    expect(result.err).not.toContain("at ");
    expect(() => readConfig(dir)).toThrow();
  });

  it.skipIf(process.platform === "win32")("o config com o token fica só para o dono", async () => {
    const url = await whoamiServer();
    const dir = home();
    expect((await run(["login", url], dir, `${TOKEN}\n`)).code).toBe(0);
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
  });

  it("ignora sequências de escape digitadas ou coladas no token", async () => {
    const url = await whoamiServer();
    const inputs = [
      `${TOKEN.slice(0, 10)}\u001b[D${TOKEN.slice(10)}\n`,
      `\u001b[200~${TOKEN}\u001b[201~\n`,
      `${TOKEN.slice(0, 10)}\u001bOD${TOKEN.slice(10)}\n`,
    ];
    for (const input of inputs) {
      const dir = home();
      expect((await run(["login", url], dir, input)).code).toBe(0);
      expect(readConfig(dir)).toMatchObject({ token: TOKEN });
    }
  });

  it("Ctrl+C dentro de sequência de escape cancela e ESC ESC [ D não deixa resto", async () => {
    const url = await whoamiServer();
    const cancelled = await run(["login", url], home(), `${TOKEN.slice(0, 5)}\u001b[\u0003`);
    expect(cancelled.code).toBe(1);
    expect(cancelled.err).toContain("login cancelado");
    const dir = home();
    expect((await run(["login", url], dir, `${TOKEN.slice(0, 10)}\u001b\u001b[D${TOKEN.slice(10)}\n`)).code).toBe(0);
    expect(readConfig(dir)).toMatchObject({ token: TOKEN });
  });

  it("não aceita token nem senha na linha de comando", async () => {
    const dir = home();
    const token = await run(["login", TOKEN], dir);
    expect(token.code).toBe(2);
    expect(token.err).not.toContain(TOKEN);
    const password = await run(["login", "http://ana:segredo@127.0.0.1:4600"], dir);
    expect(password.code).toBe(2);
    expect(password.err).not.toContain("segredo");
    const noScheme = await run(["login", "ana:segredo@127.0.0.1:4600"], dir);
    expect(noScheme.code).toBe(2);
    expect(noScheme.err).not.toContain("segredo");
  });

  it("não segue redirecionamento e diz para onde ele apontava", async () => {
    const url = await whoamiServer("127.0.0.1", "redirect");
    const dir = home();
    const result = await run(["login", url], dir, `${TOKEN}\n`);
    expect(result.code).toBe(1);
    expect(result.err).toContain("redirecionou para http://127.0.0.1:9");
    expect(() => readConfig(dir)).toThrow();
  });
});

describe("workforces logout", () => {
  it("esquece servidor e token e mantém as pastas", async () => {
    const dir = home();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ server: "http://localhost:4600", token: TOKEN, folders: [{ alias: "loja", path: "/tmp/loja" }] }));
    const result = await run(["logout"], dir);
    expect(result.code).toBe(0);
    expect(readConfig(dir)).toEqual({ insecure: false, folders: [{ alias: "loja", path: "/tmp/loja" }], secretPatterns: [] });
  });
});
