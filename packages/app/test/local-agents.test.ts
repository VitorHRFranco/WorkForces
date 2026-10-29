import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChannel, channelDir, type LocalChannelHandlers } from "@workforces/bridge/channel";
import type { LocalAgentEvent, LocalStart } from "@workforces/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentChannelClient, MAX_AGENT_LINE_BYTES } from "../src/agents/channel-client.js";
import { LocalAgents } from "../src/agents/local-agents.js";

const windows = process.platform === "win32";
// Prefixo e escritório próprios: o teste nunca toca em pipes de outros processos.
const PREFIX = `wf-test-${randomBytes(6).toString("hex")}-`;
const OFFICE = `https://escritorio-${randomBytes(6).toString("hex")}.exemplo`;

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
  const channel = new LocalChannel(join(dir, PREFIX + id), handlers, () => {});
  channels.push(channel);
  await channel.listen();
  return { channel, id, calls, agentId };
}


function newApp() {
  const events: LocalAgentEvent[] = [];
  const logs: string[] = [];
  const app = new LocalAgents({ dir, prefix: PREFIX, emit: (event) => events.push(event), log: (message) => logs.push(message) });
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

  it("frame de agente que ninguém assiste não é repassado", async () => {
    const { id, channel, agentId } = await openChannel();
    const { app, events } = newApp();
    await app.deliver(id, START);
    const frame = { seq: 1, key: true, cols: 80, rows: 24, cursor: { x: 0, y: 0, visible: true }, lines: [] as [number, string][] };
    channel.send({ type: "frame", ...frame });
    channel.send({ type: "status", state: "working" });
    await waitUntil(() => events.some((event) => event.type === "status"), "status");
    expect(events.some((event) => event.type === "frame")).toBe(false);
    expect(app.list(OFFICE)[0]?.state).toBe("working");
    expect(agentId).toBeTruthy();
  });

  it("input para agente desconhecido dá false", async () => {
    const { app } = newApp();
    expect(app.input(randomUUID(), "oi")).toBe(false);
  });

  it("um scan concorrente não atrapalha a entrega do start", async () => {
    const { id, calls, agentId } = await openChannel();
    const first = newApp();
    const other = newApp();
    let done = false;
    const scanning = (async () => {
      while (!done) {
        await other.app.scan();
        await sleep(1);
      }
    })();
    const delivered = await first.app.deliver(id, START, 5000);
    done = true;
    // Confere antes de o scan que ainda corre terminar: depois da entrega, um segundo app assume o canal, como previsto.
    const listed = first.app.list(OFFICE).map((agent) => agent.agentId);
    await scanning;

    expect(delivered).toBe(true);
    expect(calls.starts).toHaveLength(1);
    expect(listed).toEqual([agentId]);
  });

  it.skipIf(windows)("pasta de canais criada depois do deliver começar é esperada", async () => {
    const late = join(tempDir!, "tarde");
    const app = new LocalAgents({ dir: late, prefix: PREFIX, emit: () => {}, log: () => {} });
    apps.push(app);
    const id = newId();
    const delivering = app.deliver(id, START, 5000);
    await sleep(300);
    mkdirSync(late, { mode: 0o700 });
    const channel = new LocalChannel(join(late, PREFIX + id), {
      onStart: () => {},
      onInput: () => {},
      onWatch: () => {},
      info: () => ({ agentId: randomUUID(), label: "x", office: OFFICE, cols: 80, rows: 24, state: "idle" }),
    }, () => {});
    channels.push(channel);
    await channel.listen();
    expect(await delivering).toBe(true);
  });

  it.skipIf(windows)("pasta de canais que outros escrevem não serve", async () => {
    const open = join(tempDir!, "aberta");
    mkdirSync(open, { mode: 0o777 });
    chmodSync(open, 0o777);
    const app = new LocalAgents({ dir: open, prefix: PREFIX, emit: () => {}, log: () => {} });
    apps.push(app);
    expect(await app.deliver(newId(), START, 300)).toBe(false);
  });

  it.skipIf(windows)("pasta de canais que é link simbólico: deliver dá false", async () => {
    const real = join(tempDir!, "real");
    mkdirSync(real, { mode: 0o700 });
    const link = join(tempDir!, "link");
    symlinkSync(real, link);
    const id = newId();
    const calls = { starts: 0 };
    const channel = new LocalChannel(join(real, PREFIX + id), {
      onStart: () => calls.starts++,
      onInput: () => {},
      onWatch: () => {},
      info: () => ({ agentId: randomUUID(), label: null, office: null, cols: 80, rows: 24, state: "idle" }),
    }, () => {});
    channels.push(channel);
    await channel.listen();

    const events: LocalAgentEvent[] = [];
    const app = new LocalAgents({ dir: link, prefix: PREFIX, emit: (event) => events.push(event), log: () => {} });
    apps.push(app);

    expect(await app.deliver(id, START, 300)).toBe(false);
    await app.scan();
    expect(calls.starts).toBe(0);
    expect(app.list(OFFICE)).toEqual([]);
  });
});

describe("AgentChannelClient", () => {
  const INFO = { type: "info", agentId: randomUUID(), label: null, office: null, cols: 80, rows: 24, state: "idle" };

  async function junkServer(junk: string | Buffer) {
    const path = windows ? `\\\\.\\pipe\\${PREFIX}${newId()}` : join(tempDir!, `junk-${newId()}`);
    const server = createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.write(`${JSON.stringify(INFO)}\n`);
        setTimeout(() => socket.write(junk), 20);
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    return { path, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it.each([
    ["linha inválida", "isto não é json\n"],
    ["linha acima do limite", Buffer.alloc(MAX_AGENT_LINE_BYTES + 10, 0x61)],
  ])("%s fecha a conexão", async (_name, junk) => {
    const server = await junkServer(junk);
    try {
      const client = await AgentChannelClient.connect(server.path);
      let closed = false;
      client.onClose = () => {
        closed = true;
      };
      await waitUntil(() => closed, "fechamento");
    } finally {
      await server.close();
    }
  });
});
