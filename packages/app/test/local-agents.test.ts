import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHANNEL_PREFIX, LocalChannel, channelDir, type LocalChannelHandlers } from "@workforces/bridge/channel";
import type { LocalAgentEvent, LocalStart } from "@workforces/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAgents } from "../src/agents/local-agents.js";

const windows = process.platform === "win32";
const OFFICE = "https://escritorio.exemplo";

let dir: string;
let tempDir: string | null;
const channels: LocalChannel[] = [];
const apps: LocalAgents[] = [];

beforeEach(() => {
  tempDir = windows ? null : mkdtempSync(join(tmpdir(), "wf-local-agents-"));
  dir = tempDir ?? channelDir();
});
afterEach(async () => {
  for (const app of apps.splice(0)) app.closeAll();
  for (const channel of channels.splice(0)) await channel.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitUntil(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`tempo esgotado esperando: ${what}`);
    await sleep(20);
  }
}

const START: LocalStart = { type: "start", server: OFFICE, token: "tok", label: "Claude do teste", secretPatterns: [] };

function newId(): string {
  return randomBytes(16).toString("hex");
}

async function openChannel(id = newId()) {
  const calls = { starts: [] as LocalStart[], inputs: [] as string[], watch: [] as boolean[] };
  const agentId = randomUUID();
  let office: string | null = null;
  let label: string | null = null;
  const handlers: LocalChannelHandlers = {
    onStart: (start) => {
      calls.starts.push(start);
      office = start.server;
      label = start.label;
    },
    onInput: (data) => calls.inputs.push(data),
    onWatch: (on) => calls.watch.push(on),
    info: () => ({ agentId, label, office, cols: 80, rows: 24, state: "idle" }),
  };
  const channel = new LocalChannel(join(dir, CHANNEL_PREFIX + id), handlers, () => {});
  channels.push(channel);
  await channel.listen();
  return { channel, id, calls, agentId };
}

function newApp() {
  const events: LocalAgentEvent[] = [];
  const logs: string[] = [];
  const app = new LocalAgents({ dir, emit: (event) => events.push(event), log: (message) => logs.push(message) });
  apps.push(app);
  return { app, events, logs };
}

describe("LocalAgents", () => {
  it("entrega o start, e o agente aparece no escritório certo", async () => {
    const { id, calls, agentId } = await openChannel();
    const { app, events } = newApp();

    expect(await app.deliver(id, START)).toBe(true);

    expect(calls.starts).toEqual([START]);
    expect(app.list(START.server)).toEqual([
      { agentId, label: START.label, office: OFFICE, state: "idle", cols: 80, rows: 24 },
    ]);
    expect(app.list("https://outro.exemplo")).toEqual([]);
    expect(events).toContainEqual({ type: "changed" });
  });

  it("um app novo encontra o agente que já estava rodando", async () => {
    const { id, agentId } = await openChannel();
    const first = newApp();
    expect(await first.app.deliver(id, START)).toBe(true);
    first.app.closeAll();

    const second = newApp();
    await second.app.scan();

    expect(second.app.list(OFFICE).map((agent) => agent.agentId)).toEqual([agentId]);
  });

  it("assistir traz quadros; digitar chega ao agente; sair do painel desliga", async () => {
    const { id, channel, calls, agentId } = await openChannel();
    const { app, events } = newApp();
    await app.deliver(id, START);

    app.watch(agentId);
    await waitUntil(() => calls.watch.includes(true), "watch");

    const frame = { seq: 1, key: true, cols: 80, rows: 24, cursor: { x: 0, y: 0, visible: true }, lines: [[0, "oi"]] as [number, string][] };
    channel.send({ type: "frame", ...frame });
    await waitUntil(() => events.some((event) => event.type === "frame"), "quadro");
    expect(events.find((event) => event.type === "frame")).toEqual({ type: "frame", agentId, frame });

    expect(app.input(agentId, "oi")).toBe(true);
    await waitUntil(() => calls.inputs.length === 1, "input");
    expect(calls.inputs).toEqual(["oi"]);

    app.unwatch(agentId);
    await waitUntil(() => calls.watch.at(-1) === false, "unwatch");
  });

  it("agente que fecha sai da lista com aviso", async () => {
    const { id, channel } = await openChannel();
    const { app, events } = newApp();
    await app.deliver(id, START);
    events.length = 0;

    await channel.close();
    await waitUntil(() => app.list(OFFICE).length === 0, "saída da lista");

    expect(events).toContainEqual({ type: "changed" });
  });

  it("sem canal no prazo, deliver dá false", async () => {
    const { app } = newApp();
    expect(await app.deliver(newId(), START, 300)).toBe(false);
  });

  it("digitação grande demais não é mandada", async () => {
    const { id, calls, agentId } = await openChannel();
    const { app } = newApp();
    await app.deliver(id, START);

    expect(app.input(agentId, "x".repeat(4097))).toBe(false);
    await sleep(100);
    expect(calls.inputs).toEqual([]);
  });

  it.skipIf(windows)("pasta de canais que é link simbólico: deliver dá false", async () => {
    const real = join(tempDir!, "real");
    mkdirSync(real, { mode: 0o700 });
    const link = join(tempDir!, "link");
    symlinkSync(real, link);
    const id = newId();
    const calls = { starts: 0 };
    const channel = new LocalChannel(join(real, CHANNEL_PREFIX + id), {
      onStart: () => calls.starts++,
      onInput: () => {},
      onWatch: () => {},
      info: () => ({ agentId: randomUUID(), label: null, office: null, cols: 80, rows: 24, state: "idle" }),
    }, () => {});
    channels.push(channel);
    await channel.listen();

    const events: LocalAgentEvent[] = [];
    const app = new LocalAgents({ dir: link, emit: (event) => events.push(event), log: () => {} });
    apps.push(app);

    expect(await app.deliver(id, START, 300)).toBe(false);
    await app.scan();
    expect(calls.starts).toBe(0);
    expect(app.list(OFFICE)).toEqual([]);
  });
});
