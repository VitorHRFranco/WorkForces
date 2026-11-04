import { randomBytes, randomUUID } from "node:crypto";
import type { LocalStart, SpawnOutcome } from "@workforces/protocol";
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
  deliver(channelId: string, start: LocalStart, owner: { user: string }): Promise<boolean>;
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
    const agentId = randomUUID();
    const channelId = randomBytes(16).toString("hex");
    const title = windowTitle(alias, agentId);
    try {
      await deps.spawner.open({ folder: folder.path, title, node, agentId, channelId });
    } catch (error) {
      deps.log(`não consegui abrir a janela: ${(error as Error).message}`);
      return { ok: false, error: error instanceof SpawnFailure ? error.reason : "spawn-failed" };
    }
    const minimizing = deps.minimize(title).catch(() => {});
    const answered = await deps.deliver(
      channelId,
      { type: "start", server: office.url, token: token.token, label: alias, secretPatterns: deps.folders.secretPatterns(), anchor: office.anchor },
      { user: office.userName },
    );
    if (answered) return { ok: true };
    // Restaura só depois de a minimização terminar: senão a janela que voltou à tela poderia ser minimizada em seguida.
    await minimizing;
    await deps.onNoAnswer(title).catch(() => {});
    return { ok: false, error: "no-answer" };
  }
}
