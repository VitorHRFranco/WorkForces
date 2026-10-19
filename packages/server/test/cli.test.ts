import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountServices } from "../src/accounts/index.js";
import { openDb } from "../src/db.js";
import { runServerCli } from "../src/server-cli.js";
import { startServer } from "../src/server.js";
import { createUser, testConfig } from "./helpers/setup.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const cleanTempDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
};

afterEach(cleanTempDirs);

function output() {
  const lines: string[] = [];
  return { lines, out: { log: (m: string) => lines.push(m), error: (m: string) => lines.push(`ERRO ${m}`) } };
}

describe("startServer", () => {
  it("sem contas imprime o convite de admin; com contas, não", async () => {
    const dataDir = tempDir("wf-data-");
    const logs: string[] = [];
    const first = await startServer(testConfig({ dataDir }), { log: (m) => logs.push(m) });
    expect(logs.join("\n")).toMatch(/convite de admin válido por 24 h: http:\/\/localhost:4600\/invite\/[A-Za-z0-9_-]+/);
    await createUser(first.accounts, "ana", { admin: true });
    await first.app.close();
    logs.length = 0;
    const second = await startServer(testConfig({ dataDir }), { log: (m) => logs.push(m) });
    expect(logs.join("\n")).not.toContain("convite");
    await second.app.close();
  });
});

describe("workforces-server user disable", () => {
  it("desativa a conta pelo nome", async () => {
    const dataDir = tempDir("wf-data-");
    const db = openDb(join(dataDir, "workforces.db"));
    await createUser(createAccountServices(db, Date.now), "Ana");
    db.close();
    const { lines, out } = output();
    expect(await runServerCli(["user", "disable", "ana"], { WF_DATA_DIR: dataDir }, out)).toBe(0);
    expect(lines.join("\n")).toContain("conta Ana desativada");
    const check = openDb(join(dataDir, "workforces.db"));
    expect(createAccountServices(check, Date.now).users.byNameIncludingDisabled("ana")?.disabled).toBe(true);
    check.close();
  });

  it("porta ocupada devolve 1 com mensagem amigável", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    try {
      const port = (blocker.address() as AddressInfo).port;
      const { lines, out } = output();
      const env = { WF_PORT: String(port), WF_HOST: "127.0.0.1", WF_DATA_DIR: tempDir("wf-data-") };
      expect(await runServerCli(["start"], env, out)).toBe(1);
      expect(lines.join("\n")).toContain("já está em uso");
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("mapa ilegível na subida sai com 2 e diz o motivo", async () => {
    const dir = tempDir("wf-data-");
    const { lines, out } = output();
    expect(await runServerCli(["start"], { WF_DATA_DIR: dir, WF_MAP: join(dir, "nao-existe.tmj") }, out)).toBe(2);
    expect(lines.join("\n")).toContain("não consegui ler o mapa");
  });

  it("banco ausente, uso errado e configuração insegura", async () => {
    const empty = tempDir("wf-data-");
    const a = output();
    expect(await runServerCli(["user", "disable", "ninguem"], { WF_DATA_DIR: empty }, a.out)).toBe(1);
    expect(a.lines.join("\n")).toContain("banco não encontrado");
    const b = output();
    expect(await runServerCli(["voar"], {}, b.out)).toBe(2);
    expect(b.lines.join("\n")).toContain("uso: workforces-server");
    const h = output();
    expect(await runServerCli(["--help"], {}, h.out)).toBe(0);
    expect(h.lines.join("\n")).toContain("uso: workforces-server");
    expect(h.lines.join("\n")).not.toContain("ERRO");
    const c = output();
    expect(await runServerCli(["start"], { WF_PUBLIC_URL: "http://10.0.0.5" }, c.out)).toBe(2);
    expect(c.lines.join("\n")).toContain("HTTP sem TLS");
  });
});
