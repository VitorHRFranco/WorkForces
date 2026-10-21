import type { SpawnError } from "@workforces/protocol";
import type { Config } from "../config.js";
import { MAX_OPEN_AGENTS, SpawnLimits } from "./limits.js";
import { SpawnFailure, type Spawner } from "./spawner.js";

export interface SpawnHandlerDeps {
  /** As pastas do config atual (o config pode mudar com a ponte rodando). */
  folders(): Config["folders"];
  isDirectory(path: string): boolean;
  countOpenAgents(): Promise<number>;
  spawner: Spawner;
  now(): number;
  log(message: string): void;
}

export type SpawnOutcome = { ok: true; folder: string } | { ok: false; error: SpawnError };

/** Atende um pedido de abrir agente (spec 5.8): confere o apelido no config local, aplica os limites da ponte e abre a janela. */
export class SpawnHandler {
  private readonly limits = new SpawnLimits();
  private busy = false;

  constructor(private readonly deps: SpawnHandlerDeps) {}

  async handle(alias: string): Promise<SpawnOutcome> {
    // A contagem pode demorar mais que o intervalo de 5 s: com um pedido em andamento, outro veria a mesma contagem e abriria também.
    if (this.busy) return { ok: false, error: "rate-limited" };
    this.busy = true;
    try {
      return await this.run(alias);
    } finally {
      this.busy = false;
    }
  }

  private async run(alias: string): Promise<SpawnOutcome> {
    if (!this.limits.take(this.deps.now())) return { ok: false, error: "rate-limited" };
    const folder = this.deps.folders().find((candidate) => candidate.alias === alias);
    if (!folder) return { ok: false, error: "unknown-alias" };
    if (!this.deps.isDirectory(folder.path)) return { ok: false, error: "folder-missing" };
    let open: number;
    try {
      open = await this.deps.countOpenAgents();
    } catch (error) {
      // Sem conseguir contar, não abre: o limite de agentes abertos protege o computador.
      this.deps.log(`não consegui contar os agentes abertos: ${(error as Error).message}`);
      return { ok: false, error: "spawn-failed" };
    }
    if (open >= MAX_OPEN_AGENTS) return { ok: false, error: "too-many-agents" };
    try {
      await this.deps.spawner.open(folder.path, folder.alias);
    } catch (error) {
      this.deps.log(`não consegui abrir a janela: ${(error as Error).message}`);
      return { ok: false, error: error instanceof SpawnFailure ? error.reason : "spawn-failed" };
    }
    return { ok: true, folder: folder.path };
  }
}
