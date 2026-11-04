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
    expect(() => windowCommand(agentWindow("C:\\proj\\a;b"), CLI)).toThrow(expect.objectContaining({ reason: "spawn-failed" }));
  });
});

describe("findNode", () => {
  const PROBE = "process.stdout.write(process.execPath + '\\n' + process.versions.node)";
  const NODE = "C:\\Users\\João\\node\\node.exe";
  const REAL = "C:\\real\\node.exe";
  const env = { Path: "C:\\Users\\João\\node;D:\\outro" };
  const exists = (path: string) => path === NODE || path === "D:\\outro\\node.exe";
  /** Um `run` que confere os argumentos e responde como o probe: o executável real e a versão. */
  const run = (version: string) => async (file: string, args: string[]) => {
    expect(args).toEqual(["-e", PROBE]);
    expect(file).toBe(NODE);
    return `${REAL}\r\n${version}`;
  };

  it("22.12 ou mais novo dá o executável real do probe; mais velho dá null", async () => {
    expect(await findNode(env, run("22.12.0"), exists, "win32")).toBe(REAL);
    expect(await findNode(env, run("24.0.0"), exists, "win32")).toBe(REAL);
    expect(await findNode(env, run("22.9.0"), exists, "win32")).toBeNull();
    expect(await findNode(env, run("20.11.0"), exists, "win32")).toBeNull();
  });

  it("probe malformado, falha ou sem node no PATH dá null", async () => {
    expect(await findNode(env, async () => "22.12.0", exists, "win32")).toBeNull();
    expect(await findNode(env, async () => "relativo\\node.exe\n22.12.0", exists, "win32")).toBeNull();
    expect(await findNode(env, async () => "C:\\x\\node.exe\n22.12.0\nextra", exists, "win32")).toBeNull();
    expect(await findNode(env, async () => Promise.reject(new Error("falhou")), exists, "win32")).toBeNull();
    expect(await findNode(env, run("22.12.0"), () => false, "win32")).toBeNull();
    expect(await findNode({}, run("22.12.0"), exists, "win32")).toBeNull();
  });

  it("entrada relativa ou vazia do PATH é ignorada, mesmo com node.exe", async () => {
    const calls: string[] = [];
    const found = await findNode(
      { PATH: ";.;bin;C:\\Users\\João\\node" },
      async (file) => {
        calls.push(file);
        return `${REAL}\n22.12.0`;
      },
      (path) => path === "node.exe" || path === "bin\\node.exe" || path === ".\\node.exe" || path === NODE,
      "win32",
    );
    expect(found).toBe(REAL);
    expect(calls).toEqual([NODE]);
  });

  it("WF_NODE tem prioridade", async () => {
    const seen: string[] = [];
    const found = await findNode(
      { ...env, WF_NODE: "D:\\meu\\node.exe" },
      async (file, args) => {
        seen.push(file);
        expect(args).toEqual(["-e", PROBE]);
        return "D:\\meu\\node.exe\n24.1.0";
      },
      exists,
      "win32",
    );
    expect(found).toBe("D:\\meu\\node.exe");
    expect(seen).toEqual(["D:\\meu\\node.exe"]);
  });

  it("no Windows procura node.exe no PATH, separado por ;", async () => {
    const calls: string[] = [];
    const found = await findNode(
      { Path: "C:\\a;C:\\b" },
      async (file) => {
        calls.push(file);
        return `${file}\r\n22.12.0`;
      },
      (path) => path === "C:\\a\\node" || path === "C:\\b\\node.exe",
      "win32",
    );
    expect(found).toBe("C:\\b\\node.exe");
    expect(calls).toEqual(["C:\\b\\node.exe"]);
  });

  it("fora do Windows procura node no PATH, separado por :", async () => {
    const calls: string[] = [];
    const found = await findNode(
      { PATH: "relativo:/opt/a:/usr/bin" },
      async (file) => {
        calls.push(file);
        return `${file}\n22.12.0`;
      },
      (path) => path === "relativo/node" || path === "/opt/a/node.exe" || path === "/usr/bin/node",
      "linux",
    );
    expect(found).toBe("/usr/bin/node");
    expect(calls).toEqual(["/usr/bin/node"]);
  });
});
