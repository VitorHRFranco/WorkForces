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
import type { AgentRecord, AgentRecordStore } from "./records.js";

export interface LocalAgentsDeps {
  /** Onde ficam os canais (`\\.\pipe\` no Windows). */
  dir: string;
  /** Começo do nome dos canais; o padrão é o do invólucro (os testes usam um próprio). */
  prefix?: string;
  /** Os agentes que este app abriu: o `scan` só conecta aos canais registrados. */
  records: Pick<AgentRecordStore, "list" | "add" | "remove">;
  emit(event: LocalAgentEvent): void;
  log(message: string): void;
}

interface Entry {
  client: AgentChannelClient;
  /** A conta que entregou o `start`: "Meus agentes" mostra o agente só a ela. */
  record: AgentRecord;
  state: AgentState;
  watched: boolean;
}

const RETRY_MS = 250;
/** Um registro sem canal na pasta só sai na segunda busca seguida: uma listagem que deixasse passar um agente vivo o perderia de vez. */
const GONE_AFTER_SCANS = 2;
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
  /** Buscas em andamento: só a que começa sozinha conta as faltas (duas ao mesmo tempo veem quase a mesma listagem). */
  private scanning = 0;
  /** Canal registrado que faltou na pasta → quantas buscas seguidas sem ele. */
  private missing = new Map<string, number>();
  private closedAll = false;

  constructor(private readonly deps: LocalAgentsDeps) {}

  /**
   * Conecta aos agentes registrados que ainda não temos. Um canal sem registro nunca é tocado: pode ser de outro usuário
   * do Windows com o nome certo. Registro sem canal na pasta em duas buscas seguidas é de agente que terminou, e sai.
   * Recusa ou demora: ignora.
   */
  async scan(): Promise<void> {
    const counts = this.scanning === 0;
    this.scanning++;
    try {
      if ((await this.dirState()) !== "ok") return;
      // Os registros antes da pasta: um registro novo é de canal que já existia, e a listagem seguinte o encontra.
      const records = this.deps.records.list();
      let names: string[];
      try {
        names = await readdir(this.deps.dir);
      } catch (error) {
        this.deps.log(`não consegui listar os canais dos agentes: ${errorMessage(error)}`);
        return;
      }
      const present = new Set(names.filter((name) => name.startsWith(this.prefix)).map((name) => name.slice(this.prefix.length)));
      const gone = this.countMissing(records, present, counts);
      if (gone.length > 0) this.deps.records.remove(gone);
      const before = this.snapshot();
      await Promise.all(records.filter((record) => present.has(record.channelId)).map((record) => this.adopt(record)));
      if (this.snapshot() !== before) this.deps.emit({ type: "changed" });
    } finally {
      this.scanning--;
    }
  }

  /** Manda o `start` a um agente recém-aberto; true quando ele confirma o escritório. Confirmado, o agente fica registrado em nome de `owner`. */
  async deliver(channelId: string, start: LocalStart, owner: { user: string }, timeoutMs = DELIVER_TIMEOUT_MS): Promise<boolean> {
    if (!isChannelId(channelId)) return false;
    const deadline = Date.now() + timeoutMs;
    const left = () => deadline - Date.now();
    // Enquanto entregamos, o `scan` não pode conectar a este canal: um `hello` novo derruba o nosso.
    this.connecting.add(channelId);
    try {
      while (!this.closedAll && left() > 0) {
        const dir = await this.dirState();
        if (dir === "unsafe") return false;
        if (dir === "ok") {
          let client: AgentChannelClient | null = null;
          try {
            client = await AgentChannelClient.connect(this.pathOf(channelId), Math.max(1, Math.min(CONNECT_TRY_MS, left())));
          } catch {
            // O invólucro ainda não abriu o canal: tenta de novo.
          }
          if (client) {
            // O `start` vale uma vez no invólucro, e `sendStart` não o repete se o escritório já confere.
            if (!this.closedAll && (await this.sendStart(client, start, Math.max(1, left())))) {
              // Registra mesmo se o app estiver saindo: o agente segue rodando, e o próximo início o acha pelo registro.
              const record: AgentRecord = { channelId, agentId: client.info.agentId, office: start.server, user: owner.user, at: Date.now() };
              this.deps.records.add(record);
              if (this.closedAll) {
                client.close();
                return false;
              }
              this.register(channelId, client, record);
              this.deps.emit({ type: "changed" });
              return true;
            }
            client.close();
          }
        }
        await sleep(Math.max(0, Math.min(RETRY_MS, left())));
      }
      return false;
    } finally {
      this.connecting.delete(channelId);
    }
  }

  /** Os agentes que este app abriu para a conta `user` do escritório `office`. */
  list(office: string, user: string): LocalAgentInfo[] {
    const agents: LocalAgentInfo[] = [];
    for (const { client, record, state } of this.entries.values()) {
      const { info } = client;
      if (record.office !== office || record.user !== user || info.office !== office) continue;
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

  private get prefix(): string {
    return this.deps.prefix ?? CHANNEL_PREFIX;
  }

  private pathOf(channelId: string): string {
    const name = this.prefix + channelId;
    return isWindows() ? this.deps.dir + name : join(this.deps.dir, name);
  }

  /** Fora do Windows, só vale a pasta que é deste usuário e que ninguém mais escreve (o /proc é legível por todos). */
  private async dirState(): Promise<"ok" | "missing" | "unsafe"> {
    if (isWindows()) return "ok";
    try {
      const stat = await lstat(this.deps.dir);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0) return "ok";
      this.deps.log(`a pasta de canais ${this.deps.dir} não é só deste usuário; não vou conectar aos agentes`);
      return "unsafe";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      this.deps.log(`não consegui conferir a pasta de canais: ${errorMessage(error)}`);
      return "unsafe";
    }
  }

  /**
   * Conta as faltas de cada registro nesta listagem e devolve os que faltaram em GONE_AFTER_SCANS buscas seguidas. Canal
   * visto zera a contagem; uma busca que não começou sozinha (`counts` falso) não soma falta nenhuma.
   */
  private countMissing(records: readonly AgentRecord[], present: ReadonlySet<string>, counts: boolean): string[] {
    const missing = new Map<string, number>();
    const gone: string[] = [];
    for (const { channelId } of records) {
      if (present.has(channelId)) continue;
      const count = (this.missing.get(channelId) ?? 0) + (counts ? 1 : 0);
      if (count >= GONE_AFTER_SCANS) gone.push(channelId);
      else if (count > 0) missing.set(channelId, count);
    }
    this.missing = missing;
    return gone;
  }

  private async adopt(record: AgentRecord): Promise<void> {
    const { channelId } = record;
    if (this.entries.has(channelId) || this.connecting.has(channelId)) return;
    this.connecting.add(channelId);
    try {
      const client = await AgentChannelClient.connect(this.pathOf(channelId));
      if (this.closedAll || this.entries.has(channelId)) {
        client.close();
        return;
      }
      const { info } = client;
      if (info.agentId !== record.agentId || info.office !== record.office) {
        // Não é o agente que este app abriu (outro programa ocupou o nome depois que ele terminou): o registro sai.
        client.close();
        this.deps.records.remove([channelId]);
        this.deps.log(`o canal ${channelId} não é do agente registrado (${record.agentId}); ignorado`);
        return;
      }
      this.register(channelId, client, record);
    } catch {
      // Recusou ou demorou: o agente pode estar ocupado. Ignora; o próximo scan tenta de novo.
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

  private register(channelId: string, client: AgentChannelClient, record: AgentRecord): void {
    this.entries.get(channelId)?.client.close();
    const entry: Entry = { client, record, state: client.info.state, watched: false };
    this.entries.set(channelId, entry);
    client.onMessage = (message) => this.handle(entry, message);
    // O `closeAll` (sair do app) tira este aviso antes de fechar: os registros ficam para o próximo início.
    client.onClose = () => {
      if (this.entries.get(channelId) !== entry) return;
      this.entries.delete(channelId);
      // O nome do canal ficou livre: outro usuário do Windows poderia ocupá-lo antes da próxima busca.
      this.deps.records.remove([channelId]);
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
