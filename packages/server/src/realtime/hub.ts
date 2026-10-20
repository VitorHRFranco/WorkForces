import {
  CLOSE_CODES,
  type AgentHello,
  type AgentInfo,
  type AgentState,
  type Cursor,
  type FrameBody,
  type ServerToClient,
} from "@workforces/protocol";

export type WatchResult = "ok" | "gone" | "denied";

export const SLOW_VIEWER_BYTES = 1024 * 1024;
/** Navegador com mais que isto pendente nos avisos gerais é desconectado (o welcome refaz o estado ao reconectar). */
export const SLOW_CLIENT_BYTES = 4 * 1024 * 1024;
export const AGENT_GRACE_MS = 30_000;
export const STALE_CHECK_MS = 200;

/** O lado da ponte visto pelo Hub. Só existe `viewers`: nada leva entrada ao PTY. */
export interface BridgeLink {
  readonly tokenId: number;
  sendViewers(n: number): void;
  close(code: number, reason: string): void;
}

export interface ClientLink {
  readonly userId: number;
  send(message: ServerToClient): void;
  bufferedAmount(): number;
  close(code: number, reason: string): void;
}

export interface Owner {
  readonly id: number;
  readonly name: string;
}

export type RegisterResult = { ok: true } | { ok: false; reason: "agent-id-taken" };

interface Screen {
  seq: number;
  cols: number;
  rows: number;
  cursor: Cursor;
  lines: string[];
}

interface AgentEntry {
  info: AgentInfo;
  link: BridgeLink | null;
  viewers: Set<ClientLink>;
  stale: Set<ClientLink>;
  /** Só existe enquanto há visitantes; nunca vai para o disco. */
  screen: Screen | null;
  removal: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setInterval> | null;
}

export class Hub {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly clients = new Set<ClientLink>();
  private readonly watching = new Map<ClientLink, string>();
  /** Quantos navegadores cada pessoa tem abertos (a troca de aba passa por 2 antes de voltar a 1). */
  private readonly online = new Map<number, number>();

  constructor(
    private readonly graceMs: number = AGENT_GRACE_MS,
    private readonly staleCheckMs: number = STALE_CHECK_MS,
    /** Regra de proximidade (spec 9): quem pode assistir os agentes de quem. */
    private readonly canWatch: (viewerId: number, ownerId: number) => boolean = () => true,
  ) {}

  registerAgent(owner: Owner, hello: AgentHello, link: BridgeLink): RegisterResult {
    const existing = this.agents.get(hello.agentId);
    if (existing && existing.info.ownerId !== owner.id) return { ok: false, reason: "agent-id-taken" };
    if (existing) {
      if (existing.link && existing.link !== link) existing.link.close(CLOSE_CODES.invalidMessage, "substituída por outra conexão");
      if (existing.removal) clearTimeout(existing.removal);
      existing.removal = null;
      existing.link = link;
      existing.screen = null;
      existing.info = { ...existing.info, label: hello.label, connected: true };
      this.broadcast({ type: "agentUpdated", agent: existing.info });
      if (existing.viewers.size > 0) link.sendViewers(existing.viewers.size);
      return { ok: true };
    }
    const entry: AgentEntry = {
      info: {
        id: hello.agentId,
        ownerId: owner.id,
        ownerName: owner.name,
        label: hello.label,
        status: "idle",
        connected: true,
        ownerAway: !this.online.has(owner.id),
      },
      link,
      viewers: new Set(),
      stale: new Set(),
      screen: null,
      removal: null,
      staleTimer: null,
    };
    this.agents.set(hello.agentId, entry);
    this.broadcast({ type: "agentAdded", agent: entry.info });
    return { ok: true };
  }

  agentFrame(link: BridgeLink, agentId: string, frame: FrameBody): void {
    const entry = this.current(link, agentId);
    if (!entry || entry.viewers.size === 0) return;
    if (frame.key) {
      entry.screen = { seq: frame.seq, cols: frame.cols, rows: frame.rows, cursor: frame.cursor, lines: new Array<string>(frame.rows).fill("") };
    } else if (!entry.screen || entry.screen.cols !== frame.cols || entry.screen.rows !== frame.rows) {
      return; // espera o quadro-chave
    }
    const screen = entry.screen;
    for (const [row, text] of frame.lines) screen.lines[row] = text;
    screen.seq = frame.seq;
    screen.cursor = frame.cursor;
    const message: ServerToClient = {
      type: "frame",
      agentId,
      seq: frame.seq,
      key: frame.key,
      cols: frame.cols,
      rows: frame.rows,
      cursor: frame.cursor,
      lines: frame.lines,
    };
    for (const viewer of entry.viewers) this.deliver(entry, viewer, message);
  }

  agentStatus(link: BridgeLink, agentId: string, state: AgentState): void {
    const entry = this.current(link, agentId);
    if (!entry) return;
    entry.info = { ...entry.info, status: state };
    this.broadcast({ type: "agentUpdated", agent: entry.info });
  }

  agentDisconnected(link: BridgeLink, agentId: string): void {
    const entry = this.current(link, agentId);
    if (!entry) return;
    entry.link = null;
    entry.screen = null;
    entry.info = { ...entry.info, connected: false };
    this.broadcast({ type: "agentUpdated", agent: entry.info });
    entry.removal = setTimeout(() => this.removeAgent(agentId), this.graceMs);
    entry.removal.unref();
  }

  /** A ponte encerrou de propósito (o `claude` terminou): o agente some na hora, sem prazo de reconexão. */
  agentEnded(link: BridgeLink, agentId: string): void {
    const entry = this.current(link, agentId);
    if (!entry) return;
    entry.link = null;
    entry.screen = null;
    if (entry.removal) clearTimeout(entry.removal);
    entry.removal = null;
    this.removeAgent(agentId);
  }

  addClient(link: ClientLink): AgentInfo[] {
    const count = (this.online.get(link.userId) ?? 0) + 1;
    this.online.set(link.userId, count);
    if (count === 1) this.setOwnerAway(link.userId, false);
    this.clients.add(link);
    return [...this.agents.values()].map((entry) => entry.info);
  }

  removeClient(link: ClientLink): void {
    this.unwatch(link);
    if (!this.clients.delete(link)) return;
    const count = (this.online.get(link.userId) ?? 1) - 1;
    if (count > 0) {
      this.online.set(link.userId, count);
      return;
    }
    this.online.delete(link.userId);
    this.setOwnerAway(link.userId, true);
  }

  /** Repetir o watch reenvia a tela (ressincronização). */
  watch(link: ClientLink, agentId: string): WatchResult {
    const entry = this.agents.get(agentId);
    if (!entry) {
      this.unwatch(link);
      return "gone";
    }
    if (!this.canWatch(link.userId, entry.info.ownerId)) {
      this.unwatch(link);
      return "denied";
    }
    if (this.watching.get(link) === agentId) {
      this.sendScreen(entry, link);
      return "ok";
    }
    this.unwatch(link);
    entry.viewers.add(link);
    this.watching.set(link, agentId);
    this.sendScreen(entry, link);
    entry.link?.sendViewers(entry.viewers.size);
    return "ok";
  }

  /** Depois de um `move`: quem saiu da zona da mesa deixa de assistir. */
  recheckWatch(link: ClientLink): void {
    const agentId = this.watching.get(link);
    if (agentId === undefined) return;
    const entry = this.agents.get(agentId);
    if (entry && this.canWatch(link.userId, entry.info.ownerId)) return;
    this.unwatch(link);
    link.send({ type: "watchEnded", agentId, reason: "left-zone" });
  }

  unwatch(link: ClientLink): void {
    const agentId = this.watching.get(link);
    if (agentId === undefined) return;
    this.watching.delete(link);
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.viewers.delete(link);
    entry.stale.delete(link);
    if (entry.stale.size === 0) this.stopStaleTimer(entry);
    entry.link?.sendViewers(entry.viewers.size);
    if (entry.viewers.size === 0) entry.screen = null;
  }

  closeBridgesForToken(tokenId: number): void {
    for (const entry of this.agents.values()) {
      const link = entry.link;
      if (link?.tokenId === tokenId) {
        link.close(CLOSE_CODES.unauthorized, "token revogado");
        this.agentDisconnected(link, entry.info.id);
      }
    }
  }

  private current(link: BridgeLink, agentId: string): AgentEntry | null {
    const entry = this.agents.get(agentId);
    return entry && entry.link === link ? entry : null;
  }

  private setOwnerAway(ownerId: number, away: boolean): void {
    for (const entry of this.agents.values()) {
      if (entry.info.ownerId !== ownerId || entry.info.ownerAway === away) continue;
      entry.info = { ...entry.info, ownerAway: away };
      this.broadcast({ type: "agentUpdated", agent: entry.info });
    }
  }

  private removeAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry || entry.link) return;
    this.stopStaleTimer(entry);
    for (const viewer of entry.viewers) {
      this.watching.delete(viewer);
      viewer.send({ type: "watchEnded", agentId, reason: "agent-gone" });
    }
    this.agents.delete(agentId);
    this.broadcast({ type: "agentRemoved", agentId });
  }

  private deliver(entry: AgentEntry, viewer: ClientLink, message: ServerToClient): void {
    if (entry.stale.has(viewer)) {
      if (viewer.bufferedAmount() > SLOW_VIEWER_BYTES || !entry.screen) return;
      entry.stale.delete(viewer);
      viewer.send(this.keyFrame(entry));
      return;
    }
    if (viewer.bufferedAmount() > SLOW_VIEWER_BYTES) return this.markStale(entry, viewer);
    viewer.send(message);
  }

  /** Tela guardada como quadro-chave; com a fila cheia, espera esvaziar (spec 10, visitante lento). */
  private sendScreen(entry: AgentEntry, link: ClientLink): void {
    if (!entry.screen) return;
    if (link.bufferedAmount() > SLOW_VIEWER_BYTES) return this.markStale(entry, link);
    entry.stale.delete(link);
    link.send(this.keyFrame(entry));
  }

  private markStale(entry: AgentEntry, viewer: ClientLink): void {
    entry.stale.add(viewer);
    if (!entry.staleTimer) {
      entry.staleTimer = setInterval(() => this.recoverStale(entry), this.staleCheckMs);
      entry.staleTimer.unref();
    }
  }

  /** Visitante lento recebe a tela inteira assim que a fila dele esvazia, mesmo com o agente parado. */
  private recoverStale(entry: AgentEntry): void {
    for (const viewer of entry.stale) {
      if (!entry.screen || viewer.bufferedAmount() > SLOW_VIEWER_BYTES) continue;
      entry.stale.delete(viewer);
      viewer.send(this.keyFrame(entry));
    }
    if (entry.stale.size === 0) this.stopStaleTimer(entry);
  }

  private stopStaleTimer(entry: AgentEntry): void {
    if (entry.staleTimer) clearInterval(entry.staleTimer);
    entry.staleTimer = null;
  }

  private keyFrame(entry: AgentEntry): ServerToClient {
    const screen = entry.screen!;
    return {
      type: "frame",
      agentId: entry.info.id,
      seq: screen.seq,
      key: true,
      cols: screen.cols,
      rows: screen.rows,
      cursor: screen.cursor,
      lines: screen.lines.map((text, row): [number, string] => [row, text]),
    };
  }

  /** Manda a todos os navegadores (menos `except`, se houver). */
  broadcast(message: ServerToClient, except?: ClientLink): void {
    for (const client of this.clients) {
      if (client === except) continue;
      if (client.bufferedAmount() > SLOW_CLIENT_BYTES) {
        client.close(CLOSE_CODES.rateLimited, "conexão lenta demais");
        continue;
      }
      client.send(message);
    }
  }
}
