import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiagnostic } from "../src/log/diagnostic.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-diag-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const header = ["WorkForces 1.2.3", "gerado em 2026-11-26"];

describe("buildDiagnostic", () => {
  it("junta os logs do app do mais antigo ao mais novo, cada um sob o seu título", () => {
    writeFileSync(join(dir, "app.2.log"), "dois\n");
    writeFileSync(join(dir, "app.1.log"), "um\n");
    writeFileSync(join(dir, "app.log"), "zero\n");
    const out = buildDiagnostic({ header, logDir: dir, bridgeLog: null });
    const [a, b, c] = ["app.2.log", "app.1.log", "app.log"].map((n) => out.indexOf(`===== ${n} =====`));
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b!);
    expect(b).toBeLessThan(c!);
    expect(out).toContain("===== app.2.log =====\ndois");
    expect(out).toContain("===== app.1.log =====\num");
    expect(out).toContain("===== app.log =====\nzero");
    expect(out.startsWith("WorkForces 1.2.3\ngerado em 2026-11-26")).toBe(true);
  });

  it("sem nenhum log do app, traz o cabeçalho e (sem log)", () => {
    const out = buildDiagnostic({ header, logDir: dir, bridgeLog: null });
    expect(out).toContain("WorkForces 1.2.3");
    expect(out).toContain("(sem log)");
    expect(buildDiagnostic({ header, logDir: join(dir, "nao-existe"), bridgeLog: null })).toContain("(sem log)");
  });

  it("sem o log da ponte, avisa que ela ainda não gravou", () => {
    expect(buildDiagnostic({ header, logDir: dir, bridgeLog: null })).toContain("(a ponte ainda não gravou log)");
    expect(buildDiagnostic({ header, logDir: dir, bridgeLog: join(dir, "bridge.log") })).toContain("(a ponte ainda não gravou log)");
  });

  it("do log da ponte vêm só os últimos bytes", () => {
    const bridge = join(dir, "bridge.log");
    writeFileSync(bridge, ("A".repeat(99) + "\n").repeat(2_990) + ("B".repeat(99) + "\n").repeat(11));
    const out = buildDiagnostic({ header, logDir: dir, bridgeLog: bridge, bridgeTailBytes: 1_000 });
    const tail = out.slice(out.indexOf("===== bridge.log (fim) =====") + "===== bridge.log (fim) =====".length);
    expect(tail).toContain("B".repeat(99));
    expect(tail.length).toBeLessThanOrEqual(1_000);
    expect(tail).not.toContain("A");
  });

  it("mascara um token escrito à mão no log da ponte", () => {
    const bridge = join(dir, "bridge.log");
    const token = "wf_" + "z".repeat(30);
    writeFileSync(bridge, `usou ${token}\n`);
    const out = buildDiagnostic({ header, logDir: dir, bridgeLog: bridge });
    expect(out).not.toContain("z".repeat(30));
  });

  it("quando o corte cai no meio de um token, o fim começa numa linha inteira", () => {
    const bridge = join(dir, "bridge.log");
    const newer = "linha nova completa\n";
    writeFileSync(bridge, "antiga wf_" + "ABCDEFGHIJ".repeat(3) + "\n" + newer);
    // 10 bytes do fim do token, o \n e a linha nova.
    const out = buildDiagnostic({ header, logDir: dir, bridgeLog: bridge, bridgeTailBytes: newer.length + 1 + 10 });
    expect(out).not.toContain("ABCDEFGHIJ");
    expect(out).toContain("===== bridge.log (fim) =====\n" + newer);
  });
});
