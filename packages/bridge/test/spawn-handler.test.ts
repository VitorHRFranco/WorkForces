import { describe, expect, it } from "vitest";
import { SpawnHandler, type SpawnHandlerDeps } from "../src/listener/handler.js";
import { MAX_OPEN_AGENTS, SPAWN_INTERVAL_MS, SpawnLimits } from "../src/listener/limits.js";
import { countAgentCommandLines } from "../src/listener/open-agents.js";
import { SpawnFailure, windowCommand } from "../src/listener/spawner.js";

const CLI = "C:\\ProjLocais\\WorkForces\\packages\\bridge\\dist\\cli.js";

describe("limites da ponte", () => {
  it("uma tentativa a cada 5 s", () => {
    const limits = new SpawnLimits();
    expect(limits.take(1_000)).toBe(true);
    expect(limits.take(1_000 + SPAWN_INTERVAL_MS - 1)).toBe(false);
    expect(limits.take(1_000 + SPAWN_INTERVAL_MS)).toBe(true);
  });

  it("conta só os `workforces claude` desta instalação na lista de processos", () => {
    const lines = [
      `"C:\\Program Files\\nodejs\\node.exe" ${CLI} claude`,
      `"C:\\Program Files\\nodejs\\node.exe" ${CLI} --home "C:\\Users\\ana\\.workforces" claude`,
      `"C:\\Program Files\\nodejs\\node.exe" "${CLI.toUpperCase()}" claude "oi"`,
      `"C:\\Program Files\\nodejs\\node.exe" ${CLI} ponte`,
      `"C:\\Program Files\\nodejs\\node.exe" C:\\outra\\cli.js claude`,
      `"C:\\Program Files\\nodejs\\node.exe" ${CLI} claudette`,
    ];
    expect(countAgentCommandLines(JSON.stringify(lines), CLI)).toBe(3);
    expect(countAgentCommandLines(JSON.stringify(lines[0]), CLI)).toBe(1); // um processo só vem como string
    expect(countAgentCommandLines("", CLI)).toBe(0);
    expect(() => countAgentCommandLines("não é json", CLI)).toThrow();
  });

  it("conta o agente também quando o cli.js está num caminho com acento", () => {
    const cli = "C:\\Users\\João\\WorkForces\\packages\\bridge\\dist\\cli.js";
    const line = `"C:\\Program Files\\nodejs\\node.exe" ${cli} claude`;
    expect(countAgentCommandLines(JSON.stringify([line]), cli)).toBe(1);
  });

  it("o comando da janela vai em array, com a pasta e o config da ponte; caminho com ; é recusado", () => {
    const options = { node: "C:\\node\\node.exe", cliPath: CLI, home: "C:\\Users\\ana\\.workforces" };
    expect(windowCommand("C:\\proj\\minha loja", "loja", options)).toEqual([
      "-w",
      "new",
      "--title",
      "WorkForces: loja",
      "-d",
      "C:\\proj\\minha loja",
      "C:\\node\\node.exe",
      CLI,
      "--home",
      "C:\\Users\\ana\\.workforces",
      "claude",
    ]);
    expect(() => windowCommand("C:\\proj\\a;b", "ab", options)).toThrow(SpawnFailure);
  });
});

function deps(overrides: Partial<SpawnHandlerDeps> = {}) {
  const opened: string[] = [];
  const logs: string[] = [];
  const clock = { now: 0 };
  const base: SpawnHandlerDeps = {
    folders: () => [
      { alias: "loja", path: "C:\\proj\\loja" },
      { alias: "velha", path: "C:\\proj\\apagada" },
    ],
    isDirectory: (path) => path !== "C:\\proj\\apagada",
    countOpenAgents: async () => 0,
    spawner: { open: async (folder) => void opened.push(folder) },
    now: () => clock.now,
    log: (message) => logs.push(message),
  };
  return { deps: { ...base, ...overrides }, opened, logs, clock };
}

describe("SpawnHandler", () => {
  it("abre a pasta do apelido e responde com ela", async () => {
    const { deps: d, opened } = deps();
    expect(await new SpawnHandler(d).handle("loja")).toEqual({ ok: true, folder: "C:\\proj\\loja" });
    expect(opened).toEqual(["C:\\proj\\loja"]);
  });

  it("recusa apelido desconhecido, pasta apagada e pedido cedo demais, sem abrir nada", async () => {
    const { deps: d, opened, clock } = deps();
    const handler = new SpawnHandler(d);
    expect(await handler.handle("site")).toEqual({ ok: false, error: "unknown-alias" });
    clock.now += SPAWN_INTERVAL_MS;
    expect(await handler.handle("velha")).toEqual({ ok: false, error: "folder-missing" });
    expect(await handler.handle("loja")).toEqual({ ok: false, error: "rate-limited" });
    expect(opened).toEqual([]);
  });

  it("com 5 agentes abertos, ou sem conseguir contar, não abre", async () => {
    const full = deps({ countOpenAgents: async () => MAX_OPEN_AGENTS });
    expect(await new SpawnHandler(full.deps).handle("loja")).toEqual({ ok: false, error: "too-many-agents" });
    const broken = deps({ countOpenAgents: async () => Promise.reject(new Error("powershell sumiu")) });
    expect(await new SpawnHandler(broken.deps).handle("loja")).toEqual({ ok: false, error: "spawn-failed" });
    expect(broken.logs.join("\n")).toContain("powershell sumiu");
    expect(full.opened).toEqual([]);
    expect(broken.opened).toEqual([]);
  });

  it("sem Windows Terminal responde no-terminal; outra falha vira spawn-failed", async () => {
    const noTerminal = deps({ spawner: { open: async () => Promise.reject(new SpawnFailure("no-terminal", "sem wt.exe")) } });
    expect(await new SpawnHandler(noTerminal.deps).handle("loja")).toEqual({ ok: false, error: "no-terminal" });
    const other = deps({ spawner: { open: async () => Promise.reject(new Error("EPERM")) } });
    expect(await new SpawnHandler(other.deps).handle("loja")).toEqual({ ok: false, error: "spawn-failed" });
  });
});
