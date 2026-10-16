import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";

const TOKEN = "wf_" + "t".repeat(43);
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function whoamiServer(host = "127.0.0.1"): Promise<string> {
  const server = createServer((request, response) => {
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

const home = () => mkdtempSync(join(tmpdir(), "wf-login-"));
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
    const offline = await run(["login", "http://127.0.0.1:1"], dir, `${TOKEN}\n`);
    expect(offline.code).toBe(1);
    expect(offline.err).toContain("não consegui falar com http://127.0.0.1:1");
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
