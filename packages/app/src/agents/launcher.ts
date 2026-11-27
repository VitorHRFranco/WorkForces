import { randomBytes, randomUUID } from "node:crypto";
import type { LocalStart, SpawnOutcome } from "@workforces/protocol";
import { chooseAgent, type OpenAgent } from "./agent-choice.js";
import type { AgentIdStore } from "./agent-ids.js";
import type { TokenResult } from "./bridge-token.js";
import type { FolderStore } from "./folders.js";
import { SpawnFailure, windowTitle, type Spawner } from "./windows-terminal.js";

/** Uma tentativa de abrir agente a cada 5 s (spec 6.4). */
export const SPAWN_INTERVAL_MS = 5_000;
/** No máximo 5 agentes abertos neste computador (spec 6.4). */
export const MAX_OPEN_AGENTS = 5;

/** A foto do escritório tirada no pedido: o endereço do `start` e o token saem dela, nunca de uma leitura posterior. */
export interface SpawnOffice {
  id: string;
  url: string;
  /** A conta aberta: o agente fica registrado em nome dela, e só ela o vê em "Meus agentes". */
  userName: string;
  session: string | null;
  bridgeToken: string | null;
  /** A âncora do escritório (vai no `start`, para a ponte confiar só nela). */
  anchor: string | null;
}

export interface AgentLauncherDeps {
  platform: NodeJS.Platform;
  folders: Pick<FolderStore, "find" | "secretPatterns">;
  isDirectory(path: string): boolean;
  countOpenAgents(): Promise<number>;
  /**
   * Os agentes abertos neste computador (canal vivo), com a pasta: decidem o nome e se a conversa continua. Procura de
   * novo antes de responder, para contar também os que o app ainda não tinha adotado (logo depois de abrir o app).
   */
  openAgents(): Promise<OpenAgent[]>;
  /** As identidades dos registros (agentes que podem estar vivos): nunca são reaproveitadas, nem se não responderam à busca. */
  recordedAgentIds(): string[];
  /** A identidade do último agente de cada pasta, nome e conta: chamar de novo volta ao mesmo agente. */
  agentIds: Pick<AgentIdStore, "get" | "set">;
  findNode(): Promise<string | null>;
  /** Recebe o mesmo escritório do pedido: o aberto pode mudar enquanto a contagem e a busca do Node rodam. */
  ensureToken(office: SpawnOffice): Promise<TokenResult>;
  spawner: Spawner;
  /** Melhor esforço: nunca rejeita. */
  minimize(title: string): Promise<void>;
  /**
   * O agente não respondeu no canal: o motivo (sem Claude instalado, erro do invólucro) está escrito na janela dele, que o
   * Windows Terminal mantém aberta. O app a traz de volta à tela. Melhor esforço: nunca rejeita.
   */
  onNoAnswer(title: string): Promise<void>;
  deliver(channelId: string, start: LocalStart, owner: { user: string; folder: string }): Promise<boolean>;
  now(): number;
  log(message: string): void;
}

/** Atende o "Chamar agente" do app: aplica os limites da ponte, abre a janela e entrega as credenciais pelo canal local. */
export class AgentLauncher {
  private last = Number.NEGATIVE_INFINITY;
  private busy = false;

  constructor(private readonly deps: AgentLauncherDeps) {}

  async spawn(alias: string, office: SpawnOffice | null): Promise<SpawnOutcome> {
    // A contagem pode demorar mais que o intervalo de 5 s: com um pedido em andamento, outro veria a mesma contagem e abriria também.
    if (this.busy) return { ok: false, error: "rate-limited" };
    this.busy = true;
    try {
      return await this.run(alias, office);
    } finally {
      this.busy = false;
    }
  }

  private async run(alias: string, office: SpawnOffice | null): Promise<SpawnOutcome> {
    const { deps } = this;
    if (deps.platform !== "win32") return { ok: false, error: "unsupported" };
    // Toda tentativa gasta a vez, dando certo ou não.
    const now = deps.now();
    if (now - this.last < SPAWN_INTERVAL_MS) return { ok: false, error: "rate-limited" };
    this.last = now;
    const folder = deps.folders.find(alias);
    if (!folder) return { ok: false, error: "unknown-alias" };
    if (!deps.isDirectory(folder.path)) return { ok: false, error: "folder-missing" };
    if (office === null) return { ok: false, error: "no-office" };
    let open: number;
    try {
      open = await deps.countOpenAgents();
    } catch (error) {
      // Sem conseguir contar, não abre: o limite de agentes abertos protege o computador.
      deps.log(`não consegui contar os agentes abertos: ${(error as Error).message}`);
      return { ok: false, error: "spawn-failed" };
    }
    if (open >= MAX_OPEN_AGENTS) return { ok: false, error: "too-many-agents" };
    const node = await deps.findNode();
    if (node === null) return { ok: false, error: "no-node" };
    const token = await deps.ensureToken(office);
    if (!token.ok) return { ok: false, error: token.error };
    // O nome, a identidade e o --continue saem dos agentes abertos agora e do que foi guardado das chamadas anteriores.
    const keyOf = (label: string) => ({ office: office.url, user: office.userName, folder: folder.path, label });
    const openNow = await deps.openAgents();
    const recorded = new Set(deps.recordedAgentIds());
    const remembered = (label: string) => {
      const id = deps.agentIds.get(keyOf(label));
      return id !== null && !recorded.has(id) ? id : null;
    };
    const choice = chooseAgent(alias, folder.path, openNow, remembered);
    const agentId = choice.agentId ?? randomUUID();
    const channelId = randomBytes(16).toString("hex");
    const title = windowTitle(choice.label, agentId);
    try {
      await deps.spawner.open({ folder: folder.path, title, node, agentId, channelId, resume: choice.resume });
    } catch (error) {
      deps.log(`não consegui abrir a janela: ${(error as Error).message}`);
      return { ok: false, error: error instanceof SpawnFailure ? error.reason : "spawn-failed" };
    }
    const minimizing = deps.minimize(title).catch(() => {});
    const answered = await deps.deliver(
      channelId,
      { type: "start", server: office.url, token: token.token, label: choice.label, secretPatterns: deps.folders.secretPatterns(), anchor: office.anchor },
      { user: office.userName, folder: folder.path },
    );
    if (answered) {
      // Só o agente que abriu de verdade é lembrado: chamar a pasta de novo com ele fechado volta a ele.
      deps.agentIds.set(keyOf(choice.label), agentId);
      return { ok: true };
    }
    // Restaura só depois de a minimização terminar: senão a janela que voltou à tela poderia ser minimizada em seguida.
    await minimizing;
    await deps.onNoAnswer(title).catch(() => {});
    return { ok: false, error: "no-answer" };
  }
}
