import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/log/logger.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-log-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const now = () => new Date("2026-11-26T19:02:01.762Z");

describe("createLogger", () => {
  it("grava a linha no formato combinado e repassa ao echo", () => {
    const echoed: string[] = [];
    const log = createLogger({ dir, now, echo: (l) => echoed.push(l) });
    log.info("app", "iniciou");
    log.warn("atualização", "mensagem");
    const lines = readFileSync(join(dir, "app.log"), "utf8").split("\n");
    expect(lines[0]).toBe("2026-11-26T19:02:01.762Z info [app] iniciou");
    expect(lines[1]).toBe("2026-11-26T19:02:01.762Z aviso [atualização] mensagem");
    expect(echoed).toHaveLength(2);
    expect(echoed[1]).toBe(lines[1]);
  });

  it("grava a pilha do erro recuada", () => {
    const log = createLogger({ dir, now, echo: () => {} });
    log.error("app", "falhou", new Error("x"));
    const lines = readFileSync(join(dir, "app.log"), "utf8").trimEnd().split("\n");
    expect(lines[0]).toBe("2026-11-26T19:02:01.762Z erro [app] falhou");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1)) expect(l.startsWith("  ")).toBe(true);
    expect(lines[1]).toContain("Error: x");
  });

  it("mascara segredos antes de gravar", () => {
    const log = createLogger({ dir, now, echo: () => {} });
    log.info("app", "token wf_" + "b".repeat(30));
    expect(readFileSync(join(dir, "app.log"), "utf8")).not.toContain("b".repeat(30));
  });

  it("gira os arquivos e mantém só o número combinado", () => {
    const log = createLogger({ dir, now, maxBytes: 200, files: 3, echo: () => {} });
    for (let i = 0; i < 100; i++) log.info("app", `linha número ${i}`);
    expect(readdirSync(dir).sort()).toEqual(["app.1.log", "app.2.log", "app.log"]);
    expect(statSync(join(dir, "app.log")).size).toBeLessThan(200 + 100);
  });

  it("engole erros de disco", () => {
    const file = join(dir, "arquivo");
    writeFileSync(file, "x");
    const log = createLogger({ dir: join(file, "sub"), now, echo: () => {} });
    expect(() => {
      log.info("app", "a");
      log.warn("app", "b");
      log.error("app", "c", new Error("d"));
    }).not.toThrow();
  });
});
