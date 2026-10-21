import { CLOSE_CODES, MAX_ALIASES, type SpawnError } from "@workforces/protocol";

/** O ouvinte (`workforces ponte`) visto pelo servidor. Só recebe `spawn`, e só com apelidos que ele mesmo anunciou. */
export interface ListenerLink {
  readonly userId: number;
  readonly tokenId: number;
  sendSpawn(reqId: string, alias: string): void;
  close(code: number, reason: string): void;
}

/** Quem pediu para abrir o agente: a aba do dono. */
export interface SpawnRequester {
  readonly userId: number;
  sendResult(reqId: string, ok: boolean, error?: SpawnError): void;
}

/** A ponte abre a janela em poucos segundos; sem resposta até aqui, o navegador recebe `timeout`. */
export const SPAWN_TIMEOUT_MS = 20_000;

interface Pending {
  reqId: string;
  requester: SpawnRequester;
  listener: ListenerLink;
  timer: ReturnType<typeof setTimeout>;
}

/** Os ouvintes conectados, as pastas que cada um anuncia e os pedidos de abrir agente que esperam resposta. */
export class Listeners {
  private readonly aliases = new Map<ListenerLink, readonly string[]>();
  private readonly pending = new Map<string, Pending>();
  private changed: (userId: number) => void = () => {};

  constructor(private readonly timeoutMs = SPAWN_TIMEOUT_MS) {}

  /** Chamado sempre que muda o que um dono vê em "Chamar agente". */
  onChange(handler: (userId: number) => void): void {
    this.changed = handler;
  }

  connect(link: ListenerLink, aliases: readonly string[]): void {
    this.aliases.set(link, [...aliases]);
    this.changed(link.userId);
  }

  update(link: ListenerLink, aliases: readonly string[]): void {
    if (!this.aliases.has(link)) return;
    this.aliases.set(link, [...aliases]);
    this.changed(link.userId);
  }

  /** O ouvinte caiu: os pedidos que ele não respondeu falham na hora. */
  disconnect(link: ListenerLink): void {
    if (!this.aliases.delete(link)) return;
    for (const [key, entry] of this.pending) {
      if (entry.listener === link) this.settle(key, entry, false, "no-listener");
    }
    this.changed(link.userId);
  }

  /** O que o dono vê: as pastas de todas as pontes dele (sem repetir, em ordem, no máximo 50) e se alguma está ligada. */
  summary(userId: number): { aliases: string[]; listenerOnline: boolean } {
    const all = new Set<string>();
    let listenerOnline = false;
    for (const [link, aliases] of this.aliases) {
      if (link.userId !== userId) continue;
      listenerOnline = true;
      for (const alias of aliases) all.add(alias);
    }
    return { aliases: [...all].sort().slice(0, MAX_ALIASES), listenerOnline };
  }

  /**
   * Pede a uma ponte do próprio dono para abrir o agente (regra 1): só uma ponte desse usuário, e só com um apelido que ela anunciou.
   * Devolve o motivo da recusa, ou null quando o pedido saiu (a resposta chega depois, pela ponte ou pelo tempo esgotado).
   */
  request(requester: SpawnRequester, reqId: string, alias: string): SpawnError | null {
    const owned = [...this.aliases].filter(([link]) => link.userId === requester.userId);
    if (owned.length === 0) return "no-listener";
    const target = owned.find(([, aliases]) => aliases.includes(alias))?.[0];
    if (!target) return "unknown-alias";
    const key = this.key(requester.userId, reqId);
    if (this.pending.has(key)) return "spawn-failed";
    const timer = setTimeout(() => {
      const entry = this.pending.get(key);
      if (entry) this.settle(key, entry, false, "timeout");
    }, this.timeoutMs);
    this.pending.set(key, { reqId, requester, listener: target, timer });
    target.sendSpawn(reqId, alias);
    return null;
  }

  /** Resposta da ponte: só vale se veio da mesma ponte que recebeu o pedido. */
  result(link: ListenerLink, reqId: string, ok: boolean, error?: SpawnError): void {
    const key = this.key(link.userId, reqId);
    const entry = this.pending.get(key);
    if (!entry || entry.listener !== link) return;
    this.settle(key, entry, ok, ok ? undefined : (error ?? "spawn-failed"));
  }

  /** A aba que pediu fechou: a resposta não tem mais para onde ir. */
  forget(requester: SpawnRequester): void {
    for (const [key, entry] of this.pending) {
      if (entry.requester !== requester) continue;
      clearTimeout(entry.timer);
      this.pending.delete(key);
    }
  }

  /** Token revogado: as pontes dele caem na hora. */
  closeForToken(tokenId: number): void {
    for (const link of [...this.aliases.keys()]) {
      if (link.tokenId !== tokenId) continue;
      link.close(CLOSE_CODES.unauthorized, "token revogado");
      this.disconnect(link);
    }
  }

  private key(userId: number, reqId: string): string {
    return `${userId}:${reqId}`;
  }

  private settle(key: string, entry: Pending, ok: boolean, error?: SpawnError): void {
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.requester.sendResult(entry.reqId, ok, error);
  }
}
