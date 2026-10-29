import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHANNEL_PREFIX, isChannelId } from "@workforces/bridge/channel";
import {
  LOCAL_INPUT_MAX,
  type AgentState,
  type AgentToApp,
  type LocalAgentEvent,
  type LocalAgentInfo,
  type LocalStart,
} from "@workforces/protocol";
import { AgentChannelClient } from "./channel-client.js";

export interface LocalAgentsDeps {
  /** Onde ficam os canais (`\\.\pipe\` no Windows). */
  dir: string;
  emit(event: LocalAgentEvent): void;
  log(message: string): void;
}

interface Entry {
  client: AgentChannelClient;
  state: AgentState;
  watched: boolean;
}

const RETRY_MS = 250;
const DELIVER_TIMEOUT_MS = 20_000;
const CONNECT_TRY_MS = 3_000;

const isWindows = () => process.platform === "win32";
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Os agentes deste computador, achados pelo canal local de cada um. */
export class LocalAgents {
  /** Por id do canal: só entram os que já receberam `start`. */
  private readonly entries = new Map<string, Entry>();
  private readonly connecting = new Set<string>();
  private closedAll = false;

  constructor(private readonly deps: LocalAgentsDeps) {}

  /** Lista a pasta dos canais e conecta aos agentes que ainda não temos. Recusa ou demora: ignora. */
  async scan(): Promise<void> {
    if (!(await this.dirIsSafe())) return;
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch (error) {
      this.deps.log(`não consegui listar os canais dos agentes: ${errorMessage(error)}`);
      return;
    }
    const before = this.snapshot();
    const ids = names
      .filter((name) => name.startsWith(CHANNEL_PREFIX))
      .map((name) => name.slice(CHANNEL_PREFIX.length))
      .filter(isChannelId);
    await Promise.all(ids.map((id) => this.adopt(id)));
    if (this.snapshot() !== before) this.deps.emit({ type: "changed" });
  }

  /** Manda o `start` a um agente recém-aberto; true quando ele confirma o escritório. */
  async deliver(channelId: string, start: LocalStart, timeoutMs = DELIVER_TIMEOUT_MS): Promise<boolean> {
    if (!isChannelId(channelId) || !(await this.dirIsSafe())) return false;
    const deadline = Date.now() + timeoutMs;
    let client: AgentChannelClient | null = null;
    while (!client && !this.closedAll && deadline - Date.now() > 0) {
      try {
        client = await AgentChannelClient.connect(this.pathOf(channelId), Math.min(CONNECT_TRY_MS, deadline - Date.now()));
      } catch {
        await sleep(Math.min(RETRY_MS, Math.max(0, deadline - Date.now())));
      }
    }
    if (!client) return false;
    if (!(await this.sendStart(client, start, Math.max(deadline - Date.now(), 1_000)))) {
      client.close();
      return false;
    }
    if (this.closedAll) {
      client.close();
      return false;
    }
    this.register(channelId, client);
    this.deps.emit({ type: "changed" });
    return true;
  }

  list(office: string): LocalAgentInfo[] {
    const agents: LocalAgentInfo[] = [];
    for (const { client, state } of this.entries.values()) {
      const { info } = client;
      if (info.office !== office) continue;
      agents.push({ agentId: info.agentId, label: info.label ?? "", office, state, cols: info.cols, rows: info.rows });
    }
    return agents;
  }

  watch(agentId: string): void {
    const entry = this.find(agentId);
    if (!entry) return;
    entry.watched = true;
    entry.client.send({ type: "watch" });
  }

  unwatch(agentId: string): void {
    const entry = this.find(agentId);
    if (!entry) return;
    entry.watched = false;
    entry.client.send({ type: "unwatch" });
  }

  /** Digitação do painel do dono; só vai se o agente existe e a mensagem cabe no limite do canal. */
  input(agentId: string, data: string): boolean {
    const entry = this.find(agentId);
    if (!entry || data.length === 0 || data.length > LOCAL_INPUT_MAX) return false;
    return entry.client.send({ type: "input", data });
  }

  closeAll(): void {
    this.closedAll = true;
    for (const entry of this.entries.values()) {
      entry.client.onMessage = null;
      entry.client.onClose = null;
      entry.client.close();
    }
    this.entries.clear();
  }

  private pathOf(channelId: string): string {
    const name = CHANNEL_PREFIX + channelId;
    return isWindows() ? this.deps.dir + name : join(this.deps.dir, name);
  }

  /** Fora do Windows, o `start` só vai se a pasta dos canais for deste usuário (o /proc é legível por todos). */
  private async dirIsSafe(): Promise<boolean> {
    if (isWindows()) return true;
    try {
      const stat = await lstat(this.deps.dir);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()) return true;
      this.deps.log(`a pasta de canais ${this.deps.dir} não é deste usuário; não vou conectar aos agentes`);
    } catch (error) {
      this.deps.log(`não consegui conferir a pasta de canais: ${errorMessage(error)}`);
    }
    return false;
  }

  private async adopt(channelId: string): Promise<void> {
    if (this.entries.has(channelId) || this.connecting.has(channelId)) return;
    this.connecting.add(channelId);
    try {
      const client = await AgentChannelClient.connect(this.pathOf(channelId));
      // Agente que ainda não recebeu `start` não é nosso: soltamos o canal para o `deliver` usar.
      if (client.info.office === null || this.closedAll || this.entries.has(channelId)) client.close();
      else this.register(channelId, client);
    } catch {
      // Recusou ou demorou: pode ser um pipe de outro programa. Ignora, sem apagar nada.
    } finally {
      this.connecting.delete(channelId);
    }
  }

  private sendStart(client: AgentChannelClient, start: LocalStart, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        client.onMessage = null;
        client.onClose = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      client.onClose = () => finish(false);
      client.onMessage = (message) => {
        if (message.type === "info" && message.office === start.server) finish(true);
      };
      if (client.info.office === start.server) return finish(true);
      if (!client.send(start)) finish(false);
    });
  }

  private register(channelId: string, client: AgentChannelClient): void {
    this.entries.get(channelId)?.client.close();
    const entry: Entry = { client, state: client.info.state, watched: false };
    this.entries.set(channelId, entry);
    client.onMessage = (message) => this.handle(entry, message);
    client.onClose = () => {
      if (this.entries.get(channelId) !== entry) return;
      this.entries.delete(channelId);
      this.deps.log(`o agente ${client.info.label ?? channelId} fechou o canal`);
      this.deps.emit({ type: "changed" });
    };
  }

  private handle(entry: Entry, message: AgentToApp): void {
    const agentId = entry.client.info.agentId;
    switch (message.type) {
      case "frame": {
        if (!entry.watched) return;
        const { type: _type, ...frame } = message;
        this.deps.emit({ type: "frame", agentId, frame });
        return;
      }
      case "status":
        entry.state = message.state;
        this.deps.emit({ type: "status", agentId, state: message.state });
        return;
      case "info":
        entry.state = message.state;
        this.deps.emit({ type: "changed" });
        return;
    }
  }

  private find(agentId: string): Entry | undefined {
    for (const entry of this.entries.values()) if (entry.client.info.agentId === agentId) return entry;
    return undefined;
  }

  private snapshot(): string {
    return JSON.stringify(
      [...this.entries.entries()].map(([id, { client, state }]) => [id, client.info.agentId, client.info.label, client.info.office, state]),
    );
  }
}
