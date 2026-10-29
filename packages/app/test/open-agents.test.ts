import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { COUNT_SCRIPT, countOpenAgents, type PowerShellRunner } from "../src/agents/open-agents.js";

const fake = (result: { code: number | null; stdout: string; stderr?: string }): PowerShellRunner => async () => ({ stderr: "", ...result });

describe("contagem de agentes abertos: falha fechada", () => {
  it("aceita só um número com código 0", async () => {
    expect(await countOpenAgents("C:\\cli.js", 1000, fake({ code: 0, stdout: "3" }))).toBe(3);
    expect(await countOpenAgents("C:\\cli.js", 1000, fake({ code: 0, stdout: "0\r\n" }))).toBe(0);
  });

  it("saída vazia, não numérica ou com código diferente de 0 rejeita", async () => {
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: 0, stdout: "" }))).rejects.toThrow();
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: 0, stdout: "dois" }))).rejects.toThrow();
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: 0, stdout: "1 2" }))).rejects.toThrow();
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: 1, stdout: "", stderr: "falhou" }))).rejects.toThrow(/falhou/);
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: 1, stdout: "0" }))).rejects.toThrow();
    await expect(countOpenAgents("C:\\cli.js", 1000, fake({ code: null, stdout: "0" }))).rejects.toThrow();
  });

  it("erro ou prazo estourado do processo rejeita", async () => {
    await expect(countOpenAgents("C:\\cli.js", 1000, async () => Promise.reject(new Error("passou do prazo")))).rejects.toThrow(/prazo/);
  });

  it("o script sai com 1 no catch", () => {
    expect(COUNT_SCRIPT).toContain("catch {");
    expect(COUNT_SCRIPT).toContain("exit 1");
  });
});

describe("contagem de agentes abertos", () => {
  it.skipIf(process.platform !== "win32")(
    "conta só os node.exe com este cli.js e o comando claude, com acento no caminho",
    async () => {
      const cli = "C:\\Pasta Ação\\cli.js";
      const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)", cli, "claude"], { stdio: "ignore", windowsHide: true });
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(await countOpenAgents(cli, 50_000)).toBeGreaterThanOrEqual(1);
        expect(await countOpenAgents("C:\\Outra Pasta\\cli.js", 50_000)).toBe(0);
      } finally {
        child.kill();
      }
    },
    60_000,
  );
});
