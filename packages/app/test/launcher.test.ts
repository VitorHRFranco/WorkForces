import { describe, expect, it } from "vitest";
import type { LocalStart } from "@workforces/protocol";
import { AgentLauncher, MAX_OPEN_AGENTS, SPAWN_INTERVAL_MS, type AgentLauncherDeps, type SpawnOffice } from "../src/agents/launcher.js";
import { SpawnFailure, type AgentWindow } from "../src/agents/windows-terminal.js";

const OFFICE: SpawnOffice = { id: "of-1", url: "https://escritorio.exemplo", userName: "ana", session: "sessao", bridgeToken: null, anchor: null };

function setup(overrides: Partial<AgentLauncherDeps> = {}) {
  const opened: AgentWindow[] = [];
  const minimized: string[] = [];
  const restored: string[] = [];
  const delivered: Array<{ channelId: string; start: LocalStart; owner: { user: string } }> = [];
  const logs: string[] = [];
  const clock = { now: 0 };
  const base: AgentLauncherDeps = {
    platform: "win32",
    folders: {
      find: (alias) => (alias === "loja" ? { alias, path: "C:\\proj\\loja" } : alias === "velha" ? { alias, path: "C:\\proj\\apagada" } : null),
      secretPatterns: () => ["segredo-\\d+"],
    },
    isDirectory: (path) => path !== "C:\\proj\\apagada",
    countOpenAgents: async () => 0,
    findNode: async () => "C:\\node\\node.exe",
    ensureToken: async () => ({ ok: true, token: "tok", created: false }),
    spawner: { open: async (window) => void opened.push(window) },
    minimize: async (title) => void minimized.push(title),
    onNoAnswer: async (title) => void restored.push(title),
    deliver: async (channelId, start, owner) => {
      delivered.push({ channelId, start, owner });
      return true;
    },
    now: () => clock.now,
    log: (message) => logs.push(message),
  };
  return { deps: { ...base, ...overrides }, opened, minimized, restored, delivered, logs, clock };
}

describe("AgentLauncher", () => {
  it("abre a pasta do apelido, minimiza pelo título e entrega o start", async () => {
    const { deps, opened, minimized, restored, delivered } = setup();
    expect(await new AgentLauncher(deps).spawn("loja", OFFICE)).toEqual({ ok: true });
    expect(opened).toHaveLength(1);
    const window = opened[0]!;
    expect(window.folder).toBe("C:\\proj\\loja");
    expect(window.node).toBe("C:\\node\\node.exe");
    expect(window.agentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(window.channelId).toMatch(/^[0-9a-f]{32}$/);
    expect(minimized).toEqual([window.title]);
    expect(restored).toEqual([]);
    expect(delivered).toEqual([
      {
        channelId: window.channelId,
        start: { type: "start", server: OFFICE.url, token: "tok", label: "loja", secretPatterns: ["segredo-\\d+"], anchor: null },
        owner: { user: OFFICE.userName },
      },
    ]);
  });

  it("leva a âncora do escritório no start", async () => {
    const { deps, delivered } = setup();
    const anchor = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
    await new AgentLauncher(deps).spawn("loja", { ...OFFICE, anchor });
    expect(delivered[0]!.start.anchor).toBe(anchor);
  });

  it("recusa apelido desconhecido, pasta apagada, pedido cedo demais e sem escritório, sem abrir nada", async () => {
    const { deps, opened, clock } = setup();
    const launcher = new AgentLauncher(deps);
    expect(await launcher.spawn("site", OFFICE)).toEqual({ ok: false, error: "unknown-alias" });
    clock.now += SPAWN_INTERVAL_MS;
    expect(await launcher.spawn("velha", OFFICE)).toEqual({ ok: false, error: "folder-missing" });
    expect(await launcher.spawn("loja", OFFICE)).toEqual({ ok: false, error: "rate-limited" });
    clock.now += SPAWN_INTERVAL_MS;
    expect(await launcher.spawn("loja", null)).toEqual({ ok: false, error: "no-office" });
    expect(opened).toEqual([]);
  });

  it("com 5 agentes abertos, ou sem conseguir contar, não abre", async () => {
    const full = setup({ countOpenAgents: async () => MAX_OPEN_AGENTS });
    expect(await new AgentLauncher(full.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "too-many-agents" });
    const broken = setup({ countOpenAgents: async () => Promise.reject(new Error("powershell sumiu")) });
    expect(await new AgentLauncher(broken.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "spawn-failed" });
    expect(broken.logs.join("\n")).toContain("powershell sumiu");
    expect(full.opened).toEqual([]);
    expect(broken.opened).toEqual([]);
  });

  it("sem Node responde no-node; sem Windows Terminal, no-terminal; outra falha, spawn-failed", async () => {
    const noNode = setup({ findNode: async () => null });
    expect(await new AgentLauncher(noNode.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "no-node" });
    expect(noNode.opened).toEqual([]);
    const noTerminal = setup({ spawner: { open: async () => Promise.reject(new SpawnFailure("no-terminal", "sem wt.exe")) } });
    expect(await new AgentLauncher(noTerminal.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "no-terminal" });
    const other = setup({ spawner: { open: async () => Promise.reject(new Error("EPERM")) } });
    expect(await new AgentLauncher(other.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "spawn-failed" });
    expect(other.minimized).toEqual([]);
  });

  it("token recusado ou escritório fora do ar não abre a janela", async () => {
    const down = setup({ ensureToken: async () => ({ ok: false, error: "office-down" }) });
    expect(await new AgentLauncher(down.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "office-down" });
    expect(down.opened).toEqual([]);
  });

  it("agente que não responde no canal dá no-answer", async () => {
    const silent = setup({ deliver: async () => false });
    expect(await new AgentLauncher(silent.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "no-answer" });
    expect(silent.opened).toHaveLength(1);
  });

  it("sem resposta, a janela do agente volta à tela pelo título, depois de a minimização terminar", async () => {
    const steps: string[] = [];
    let finishMinimize: () => void = () => {};
    const silent = setup({
      minimize: (title) =>
        new Promise<void>((resolve) => {
          finishMinimize = () => {
            steps.push(`minimizou ${title}`);
            resolve();
          };
        }),
      deliver: async () => {
        // O canal desiste antes de a minimização acabar: a restauração espera por ela.
        setTimeout(() => finishMinimize(), 0);
        return false;
      },
      onNoAnswer: async (title) => void steps.push(`restaurou ${title}`),
    });
    expect(await new AgentLauncher(silent.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "no-answer" });
    const { title } = silent.opened[0]!;
    expect(steps).toEqual([`minimizou ${title}`, `restaurou ${title}`]);
  });

  it("uma restauração que falha não muda a resposta", async () => {
    const silent = setup({ deliver: async () => false, onNoAnswer: async () => Promise.reject(new Error("koffi sumiu")) });
    expect(await new AgentLauncher(silent.deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "no-answer" });
  });

  it("com um pedido em andamento, outro é recusado sem gastar a vez", async () => {
    let release: (count: number) => void = () => {};
    const slow = setup({ countOpenAgents: () => new Promise<number>((resolve) => (release = resolve)) });
    const launcher = new AgentLauncher(slow.deps);
    slow.clock.now = 10_000;
    const first = launcher.spawn("loja", OFFICE);
    slow.clock.now = 10_001;
    expect(await launcher.spawn("loja", OFFICE)).toEqual({ ok: false, error: "rate-limited" });
    release(4);
    expect(await first).toEqual({ ok: true });
    // 10002 ms: passou menos de 5 s desde a primeira (10000), mas só ela gastou a vez; a recusada não.
    slow.clock.now = 10_002;
    expect(await launcher.spawn("loja", OFFICE)).toEqual({ ok: false, error: "rate-limited" });
    slow.clock.now = 10_000 + SPAWN_INTERVAL_MS;
    const third = launcher.spawn("loja", OFFICE);
    release(0);
    expect(await third).toEqual({ ok: true });
  });

  it("o token vem do mesmo escritório do pedido", async () => {
    const asked: SpawnOffice[] = [];
    const office: SpawnOffice = { id: "of-a", url: "https://a.exemplo", userName: "bia", session: "sessao-a", bridgeToken: "tok-a", anchor: null };
    const { deps, delivered } = setup({
      ensureToken: async (received) => {
        asked.push(received);
        return { ok: true, token: "tok-a", created: false };
      },
    });
    expect(await new AgentLauncher(deps).spawn("loja", office)).toEqual({ ok: true });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(office);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.start.server).toBe(office.url);
    expect(delivered[0]!.start.token).toBe("tok-a");
    expect(delivered[0]!.owner).toEqual({ user: "bia" });
  });

  it("fora do Windows: unsupported", async () => {
    const { deps, opened } = setup({ platform: "linux" });
    expect(await new AgentLauncher(deps).spawn("loja", OFFICE)).toEqual({ ok: false, error: "unsupported" });
    expect(opened).toEqual([]);
  });
});
