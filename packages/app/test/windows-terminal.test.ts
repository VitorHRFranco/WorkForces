import { describe, expect, it } from "vitest";
import { SpawnFailure, findNode, windowCommand, windowTitle, type AgentWindow } from "../src/agents/windows-terminal.js";

const CLI = "C:\\ProjLocais\\WorkForces\\packages\\bridge\\dist\\cli.js";
const AGENT = "123e4567-e89b-42d3-a456-426614174000";

function agentWindow(folder: string): AgentWindow {
  return { folder, title: windowTitle("loja", AGENT), node: "C:\\node\\node.exe", agentId: AGENT, channelId: "ab".repeat(16) };
}

describe("janela do agente", () => {
  it("o comando vai em array, com título fixo e o canal; ; é recusado", () => {
    expect(windowCommand(agentWindow("C:\\proj\\minha loja"), CLI)).toEqual([
      "-w",
      "new",
      "--title",
      "WorkForces · loja · 123e4567",
      "--suppressApplicationTitle",
      "-d",
      "C:\\proj\\minha loja",
      "C:\\node\\node.exe",
      CLI,
      "claude",
      "--agent-id",
      AGENT,
      "--channel",
      "ab".repeat(16),
    ]);
    expect(() => windowCommand(agentWindow("C:\\proj\\a;b"), CLI)).toThrow(SpawnFailure);
  });
});

describe("findNode", () => {
  const run = (version: string) => async (file: string) => (file === "where.exe" ? "C:\\node\\node.exe\r\nC:\\outro\\node.exe\r\n" : `${version}\n`);

  it("Node antigo ou ausente dá null", async () => {
    expect(await findNode({}, run("20.11.0"))).toBeNull();
    expect(await findNode({}, run("22.12.0"))).toBe("C:\\node\\node.exe");
    expect(await findNode({}, run("22.11.9"))).toBeNull();
    expect(await findNode({}, async () => Promise.reject(new Error("não achei")))).toBeNull();
  });

  it("WF_NODE tem prioridade", async () => {
    const seen: string[] = [];
    const found = await findNode({ WF_NODE: "D:\\meu\\node.exe" }, async (file) => {
      seen.push(file);
      return "24.1.0";
    });
    expect(found).toBe("D:\\meu\\node.exe");
    expect(seen).toEqual(["D:\\meu\\node.exe"]);
  });
});
