import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostAddressInfo, HostSettingsInput, HostState } from "@workforces/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Host } from "../src/host/host.js";
import type { ServerLaunch, ServerStart } from "../src/host/server-process.js";
import { HostSettingsStore } from "../src/host/settings.js";

const PIN = "P".repeat(43);
const READY: ServerStart = { ok: true, pin: PIN, anchor: "PEM", adminInvite: "convite-admin" };
const NODE = "C:\\node\\node.exe";
const ENTRY = "C:\\app\\server\\dist\\embedded.js";

const WIFI: HostAddressInfo = { address: "192.168.0.10", label: "Wi-Fi · 192.168.0.10", kind: "lan" };
const WIFI_NEW: HostAddressInfo = { address: "192.168.0.20", label: "Wi-Fi · 192.168.0.20", kind: "lan" };
const HAMACHI: HostAddressInfo = { address: "25.1.2.3", label: "Hamachi · 25.1.2.3", kind: "vpn" };

const LAN: HostSettingsInput = { mode: "lan", port: 4600, lanAddress: "192.168.0.10", wanAddress: null };

/** O servidor embutido de mentira: registra o que o `Host` pede e responde o que o teste mandar. */
class FakeServer {
  readonly calls: string[] = [];
  readonly launches: ServerLaunch[] = [];
  readonly results: ServerStart[] = [];
  private readonly exitListeners: Array<() => void> = [];
  private held: { release(): void } | null = null;

  start(launch: ServerLaunch): Promise<ServerStart> {
    this.calls.push("start");
    this.launches.push(launch);
    const result = this.results.shift() ?? READY;
    if (!this.held) return Promise.resolve(result);
    return new Promise((resolve) => (this.held = { release: () => resolve(result) }));
  }

  async stop(): Promise<void> {
    this.calls.push("stop");
  }

  onExit(listener: () => void): void {
    this.exitListeners.push(listener);
  }

  /** O próximo `start` só responde quando o teste soltar. */
  hold(): () => void {
    this.held = { release: () => {} };
    return () => {
      const held = this.held;
      this.held = null;
      held?.release();
    };
  }

  crash(): void {
    for (const listener of this.exitListeners) listener();
  }
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-hostrun-"));
  file = join(dir, "host.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(options: { node?: string | null; addresses?: HostAddressInfo[] } = {}) {
  const server = new FakeServer();
  const states: HostState[] = [];
  const network = { list: options.addresses ?? [WIFI, HAMACHI] };
  const host = new Host({
    settings: HostSettingsStore.load(file, () => {}),
    server,
    findNode: async () => (options.node === undefined ? NODE : options.node),
    addresses: () => network.list,
    entry: ENTRY,
    dataDir: join(dir, "office"),
    emit: (status) => states.push(status.state),
    log: () => {},
  });
  return { host, server, states, network };
}

const saved = () => HostSettingsStore.load(file, () => {}).get();

describe("Host", () => {
  it("sem escritório criado, ligar pede para criar", async () => {
    const { host, server } = setup();
    expect(await host.turnOn()).toEqual({ ok: false, error: "crie o escritório primeiro" });
    expect(server.calls).toEqual([]);
    expect(host.status()).toMatchObject({ created: false, state: "off", settings: null });
    expect(host.hostedPin()).toBeNull();
    expect(host.localUrl()).toBeNull();
  });

  it("configure recusa porta fora da faixa e endereço que não é deste computador; a entrada válida cria o host.json sem ligar", async () => {
    const { host, server } = setup();
    expect(await host.configure({ ...LAN, port: 80 })).toEqual({ ok: false, error: "a porta precisa ser um número de 1024 a 65535" });
    expect(await host.configure({ ...LAN, lanAddress: "10.9.9.9" })).toEqual({
      ok: false,
      error: "esse endereço não é de nenhuma rede deste computador; escolha um da lista",
    });
    expect(existsSync(file)).toBe(false);
    const result = await host.configure(LAN);
    expect(result).toEqual({ ok: true, status: expect.objectContaining({ created: true, state: "off", settings: LAN }) });
    expect(existsSync(file)).toBe(true);
    expect(host.status().created).toBe(true);
    expect(host.localUrl()).toBe("https://127.0.0.1:4600");
    expect(server.calls).toEqual([]);
  });

  it("sem Node, diz o que instalar e não sobe nada", async () => {
    const { host, server } = setup({ node: null });
    await host.configure(LAN);
    expect(await host.turnOn()).toEqual({
      ok: false,
      error: "para hospedar, instale o Node.js 22.12 ou mais novo (o mesmo que os agentes usam) e tente de novo",
    });
    expect(server.calls).toEqual([]);
    expect(host.status().state).toBe("off");
  });

  it("porta ocupada: diz qual porta e onde trocar, e o escritório fica desligado", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    server.results.push({ ok: false, error: "port-in-use" });
    const error = 'a porta 4600 já está em uso por outro programa; escolha outra em "Porta"';
    expect(await host.turnOn()).toEqual({ ok: false, error });
    expect(host.status()).toMatchObject({ state: "off", error, inviteOrigin: null });
  });

  it("LAN: o convite leva o endereço escolhido; o pino e o endereço são gravados depois do ready", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    const release = server.hold();
    const turning = host.turnOn();
    await vi.waitFor(() => expect(server.calls).toEqual(["start"]));
    expect(host.status().state).toBe("starting");
    expect(saved()).toMatchObject({ pin: null, lastInviteHost: null });
    release();
    expect(await turning).toEqual({ ok: true, pin: PIN, anchor: "PEM", adminInvite: "convite-admin" });
    expect(server.launches).toEqual([
      { node: NODE, entry: ENTRY, host: "0.0.0.0", port: 4600, publicUrl: "https://192.168.0.10:4600", dataDir: join(dir, "office") },
    ]);
    expect(saved()).toMatchObject({ pin: PIN, lastInviteHost: "192.168.0.10" });
    expect(host.hostedPin()).toBe(PIN);
    expect(host.status()).toMatchObject({ state: "on", inviteOrigin: "https://192.168.0.10:4600", addressChanged: null, error: null });
  });

  it("o endereço salvo sumiu: usa a sugestão e avisa que o endereço mudou", async () => {
    const { host, server, network } = setup();
    await host.configure(LAN);
    await host.turnOn();
    await host.turnOff();
    network.list = [HAMACHI, WIFI_NEW];
    await host.turnOn();
    expect(server.launches[1]!.publicUrl).toBe("https://192.168.0.20:4600");
    expect(host.status().addressChanged).toEqual({ from: "192.168.0.10", to: "192.168.0.20" });
    expect(saved()).toMatchObject({ lanAddress: "192.168.0.10", lastInviteHost: "192.168.0.20" });
  });

  it("sem rede nenhuma: sobe em 127.0.0.1 e avisa que só este computador alcança", async () => {
    const { host, server } = setup({ addresses: [] });
    await host.configure({ ...LAN, lanAddress: null });
    expect((await host.turnOn()).ok).toBe(true);
    expect(server.launches[0]!.publicUrl).toBe("https://127.0.0.1:4600");
    expect(host.status()).toMatchObject({ state: "on", error: "este computador não está em nenhuma rede: só ele alcança o escritório" });
  });

  it("ligar duas vezes seguidas sobe um servidor só", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    const [first, second] = await Promise.all([host.turnOn(), host.turnOn()]);
    expect(first).toEqual(second);
    expect((await host.turnOn()).ok).toBe(true);
    expect(server.calls).toEqual(["start"]);
  });

  it("desligar para o servidor e o estado vira off", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    await host.turnOn();
    await host.turnOff();
    expect(server.calls).toEqual(["start", "stop"]);
    expect(host.status()).toMatchObject({ state: "off", inviteOrigin: null });
  });

  it("o servidor saiu sozinho: estado off e o aviso para ligar de novo", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    await host.turnOn();
    server.crash();
    expect(host.status()).toMatchObject({ state: "off", error: "o escritório parou sozinho; ligue de novo" });
    expect((await host.turnOn()).ok).toBe(true);
    expect(server.calls).toEqual(["start", "start"]);
  });

  it("configure com o escritório ligado reinicia com o endereço novo", async () => {
    const { host, server } = setup();
    await host.configure(LAN);
    await host.turnOn();
    const result = await host.configure({ ...LAN, port: 4700, lanAddress: "25.1.2.3" });
    expect(result).toEqual({ ok: true, status: expect.objectContaining({ state: "on", inviteOrigin: "https://25.1.2.3:4700" }) });
    expect(server.calls).toEqual(["start", "stop", "start"]);
    expect(server.launches[1]).toMatchObject({ port: 4700, publicUrl: "https://25.1.2.3:4700" });
    expect(host.localUrl()).toBe("https://127.0.0.1:4700");
  });

  it("cada mudança de estado é emitida", async () => {
    const { host, states } = setup();
    await host.configure(LAN);
    states.length = 0;
    await host.turnOn();
    await host.turnOff();
    expect(states).toEqual(["starting", "on", "stopping", "off"]);
  });
});
