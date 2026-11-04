import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountServices } from "../src/accounts/index.js";
import { openDb } from "../src/db.js";
import { runServerCli } from "../src/server-cli.js";
import { startServer } from "../src/server.js";
import { loadOrCreateCertificate } from "../src/tls/certificate.js";
import { waitUntil } from "./helpers/wait.js";
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

  it("com onAdminInvite o código vai só para o callback, nunca para o log", async () => {
    const logs: string[] = [];
    const codes: string[] = [];
    const server = await startServer(testConfig({ dataDir: tempDir("wf-data-") }), { log: (m) => logs.push(m), onAdminInvite: (code) => codes.push(code) });
    try {
      expect(codes).toHaveLength(1);
      expect(logs.join("\n")).not.toContain(codes[0]!);
    } finally {
      await server.app.close();
    }
  });

  it("com pinFile ainda sem certificado, espera e depois mostra o link com o pino", async () => {
    const dir = tempDir("wf-data-");
    const pinFile = join(dir, "root.crt");
    const logs: string[] = [];
    const config = testConfig({ dataDir: dir, pinFile, publicUrl: new URL("https://escritorio.interno") });
    const server = await startServer(config, { log: (m) => logs.push(m) });
    try {
      expect(logs.join("\n")).toContain(`aguardando o certificado da rede interna em ${pinFile} para mostrar o convite de admin`);
      expect(logs.join("\n")).not.toContain("workforces://");
      writeFileSync(pinFile, loadOrCreateCertificate(join(dir, "ca")).cert);
      await waitUntil(() => logs.some((m) => /workforces:\/\/invite\?.*&pin=[A-Za-z0-9_-]{43}/.test(m)), 5000, "o convite de admin com pino");
    } finally {
      await server.app.close();
    }
  });

  it("a mesa fechada continua fechada depois de reiniciar o servidor", async () => {
    const dataDir = tempDir("wf-data-");
    const first = await startServer(testConfig({ dataDir }), { log: () => {} });
    const ana = await createUser(first.accounts, "ana", { admin: true });
    const deskIds = first.office.map.desks.map((desk) => desk.id);
    const { deskId } = first.accounts.desks.ensure(ana.id, deskIds);
    expect(deskId).not.toBeNull();
    first.accounts.desks.setClosed(ana.id, true);
    await first.app.close();
    const second = await startServer(testConfig({ dataDir }), { log: () => {} });
    try {
      expect(second.world.isClosed(ana.id)).toBe(true);
      expect(second.world.desks().find((desk) => desk.id === deskId)).toMatchObject({ ownerId: ana.id, closed: true });
    } finally {
      await second.app.close();
    }
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
