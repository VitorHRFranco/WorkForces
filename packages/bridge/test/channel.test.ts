import { randomBytes, randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { AppToAgent, LOCAL_PROTOCOL_VERSION, type LocalStart } from "@workforces/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LocalChannel, channelPath, isChannelId, type LocalChannelHandlers } from "../src/channel/index.js";
import { sleep, waitUntil } from "./helpers/wait.js";

const channels: LocalChannel[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const channel of channels.splice(0)) await channel.close();
});

const line = (message: unknown) => `${JSON.stringify(message)}\n`;
const HELLO = line({ type: "hello", protocol: LOCAL_PROTOCOL_VERSION });

async function openChannel(options?: { helloTimeoutMs?: number }) {
  const calls = { starts: [] as LocalStart[], inputs: [] as string[], watch: [] as boolean[] };
  const agentId = randomUUID();
  let office: string | null = null;
  const handlers: LocalChannelHandlers = {
    onStart: (start) => {
      calls.starts.push(start);
      office = start.server;
    },
    onInput: (data) => calls.inputs.push(data),
    onWatch: (on) => calls.watch.push(on),
    info: () => ({ agentId, label: null, office, cols: 80, rows: 24, state: "idle" }),
  };
  const path = channelPath(randomBytes(16).toString("hex"));
  const channel = new LocalChannel(path, handlers, () => {}, options);
  channels.push(channel);
  await channel.listen();
  return { channel, path, calls, agentId };
}

/** Cliente do canal que junta tudo o que recebe. */
function client(path: string) {
  const socket = connect(path);
  sockets.push(socket);
  let raw = "";
  let closed = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    raw += chunk;
  });
  socket.on("close", () => {
    closed = true;
  });
  socket.on("error", () => {});
  return {
    send: (text: string) => socket.write(text),
    raw: () => raw,
    messages: () =>
      raw
        .split("\n")
        .filter(Boolean)
        .map((text) => JSON.parse(text) as { type: string; [key: string]: unknown }),
    closed: () => closed,
  };
}

describe("LocalChannel", () => {
  it("nada sai nem entra antes do hello", async () => {
    const { path, calls } = await openChannel();
    const c = client(path);
    c.send(line({ type: "input", data: "x" }));
    await waitUntil(c.closed, 2000, "conexão fechada");
    expect(calls.inputs).toEqual([]);
    expect(c.raw()).toBe("");
  });

  it("hello responde info; input e watch chegam aos handlers", async () => {
    const { channel, path, calls, agentId } = await openChannel();
    expect(channel.send({ type: "status", state: "working" })).toBe(false);
    const c = client(path);
    c.send(HELLO);
    await waitUntil(() => c.messages().length >= 1, 2000, "info");
    expect(c.messages()[0]).toMatchObject({ type: "info", agentId });
    c.send(line({ type: "input", data: "oi" }));
    c.send(line({ type: "watch" }));
    c.send(line({ type: "unwatch" }));
    await waitUntil(() => calls.watch.length === 2, 2000, "watch e unwatch");
    expect(calls.inputs).toEqual(["oi"]);
    expect(calls.watch).toEqual([true, false]);
  });

  it("cliente calado é derrubado", async () => {
    const { path } = await openChannel({ helloTimeoutMs: 100 });
    const c = client(path);
    await waitUntil(c.closed, 1000, "conexão fechada pelo prazo do hello");
    expect(c.raw()).toBe("");
  });

  it("linha grande demais ou lixo fecha só aquele cliente", async () => {
    const { path, agentId } = await openChannel();
    // Um hello válido, mas maior que o limite de uma linha.
    const big = client(path);
    big.send(line({ type: "hello", protocol: LOCAL_PROTOCOL_VERSION, pad: "x".repeat(70_000) }));
    await waitUntil(big.closed, 2000, "linha grande fechada");
    expect(big.raw()).toBe("");
    const junk = client(path);
    junk.send("não é json\n");
    await waitUntil(junk.closed, 2000, "lixo fechado");
    const good = client(path);
    good.send(HELLO);
    await waitUntil(() => good.messages().length >= 1, 2000, "info do terceiro cliente");
    expect(good.messages()[0]).toMatchObject({ type: "info", agentId });
  });

  it("um hello novo substitui o cliente anterior", async () => {
    const { channel, path, calls } = await openChannel();
    const first = client(path);
    first.send(HELLO);
    await waitUntil(() => first.messages().length >= 1, 2000, "info do primeiro");
    first.send(line({ type: "watch" }));
    await waitUntil(() => calls.watch.length === 1, 2000, "watch do primeiro");
    const second = client(path);
    second.send(HELLO);
    await waitUntil(() => second.messages().length >= 1, 2000, "info do segundo");
    await waitUntil(first.closed, 2000, "primeiro fechado");
    await sleep(50);
    expect(calls.watch).toEqual([true, false]);
    expect(channel.send({ type: "status", state: "working" })).toBe(true);
    await waitUntil(() => second.messages().length >= 2, 2000, "status no segundo");
    expect(second.messages()[1]).toEqual({ type: "status", state: "working" });
    expect(first.messages().filter((message) => message.type === "status")).toEqual([]);
  });

  it("start vale uma vez só e devolve o info atualizado", async () => {
    const { path, calls } = await openChannel();
    const c = client(path);
    c.send(HELLO);
    await waitUntil(() => c.messages().length >= 1, 2000, "info");
    expect(c.messages()[0]).toMatchObject({ office: null });
    const start = { type: "start", server: "https://escritorio.exemplo", token: "wf_teste", label: "loja", secretPatterns: [] };
    c.send(line(start));
    c.send(line({ ...start, server: "https://outro.exemplo" }));
    await waitUntil(() => c.messages().length >= 2, 2000, "info depois do start");
    await sleep(100);
    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0]).toEqual(start);
    expect(c.messages()).toHaveLength(2);
    expect(c.messages()[1]).toMatchObject({ type: "info", office: "https://escritorio.exemplo" });
  });
});

describe("caminho do canal", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("named pipe no Windows, socket na pasta do usuário nos outros", () => {
    expect(channelPath(id, "win32")).toBe(`\\\\.\\pipe\\workforces-agent-${id}`);
    expect(() => channelPath("../x", "linux")).toThrow();
    expect(() => channelPath("../x", "win32")).toThrow();
  });

  it("isChannelId aceita só 32 dígitos hexadecimais minúsculos", () => {
    expect(isChannelId(id)).toBe(true);
    expect(isChannelId(id.toUpperCase())).toBe(false);
    expect(isChannelId(id.slice(1))).toBe(false);
    expect(isChannelId(`${id}0`)).toBe(false);
  });
});

describe("start com âncora", () => {
  const base = { type: "start", server: "https://escritorio.exemplo", token: "wf_teste", label: "loja", secretPatterns: [] };
  it("aceita sem âncora (app antigo) e com PEM; recusa acima do limite", () => {
    expect(AppToAgent.safeParse(base).success).toBe(true);
    expect(AppToAgent.safeParse({ ...base, anchor: null }).success).toBe(true);
    expect(AppToAgent.safeParse({ ...base, anchor: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n" }).success).toBe(true);
    expect(AppToAgent.safeParse({ ...base, anchor: "x".repeat(16_385) }).success).toBe(false);
  });
});
