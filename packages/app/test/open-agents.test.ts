import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { countOpenAgents } from "../src/agents/open-agents.js";

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
