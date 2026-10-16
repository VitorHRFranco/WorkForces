import {
  CLOSE_CODES,
  type AgentHello,
  type AgentInfo,
  type AgentState,
  type Cursor,
  type FrameBody,
  type ServerToClient,
} from "@workforces/protocol";

export const SLOW_VIEWER_BYTES = 1024 * 1024;
export const AGENT_GRACE_MS = 30_000;

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
}

export class Hub {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly clients = new Set<ClientLink>();
  private readonly watching = new Map<ClientLink, string>();

  constructor(private readonly graceMs: number = AGENT_GRACE_MS) {}

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
      info: { id: hello.agentId, ownerId: owner.id, ownerName: owner.name, label: hello.label, status: "idle", connected: true },
      link,
      viewers: new Set(),
      stale: new Set(),
      screen: null,
      removal: null,
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
  }

  addClient(link: ClientLink): AgentInfo[] {
    this.clients.add(link);
    return [...this.agents.values()].map((entry) => entry.info);
  }

  removeClient(link: ClientLink): void {
    this.unwatch(link);
    this.clients.delete(link);
  }

  /** Devolve false se o agente não existe. Repetir o watch reenvia a tela (ressincronização). */
  watch(link: ClientLink, agentId: string): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    if (this.watching.get(link) === agentId) {
      if (entry.screen) link.send(this.keyFrame(entry));
      return true;
    }
    this.unwatch(link);
    entry.viewers.add(link);
    this.watching.set(link, agentId);
    if (entry.screen) link.send(this.keyFrame(entry));
    entry.link?.sendViewers(entry.viewers.size);
    return true;
  }

  unwatch(link: ClientLink): void {
    const agentId = this.watching.get(link);
    if (agentId === undefined) return;
    this.watching.delete(link);
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.viewers.delete(link);
    entry.stale.delete(link);
    entry.link?.sendViewers(entry.viewers.size);
    if (entry.viewers.size === 0) entry.screen = null;
  }

  closeBridgesForToken(tokenId: number): void {
    for (const entry of this.agents.values()) {
      if (entry.link?.tokenId === tokenId) entry.link.close(CLOSE_CODES.unauthorized, "token revogado");
    }
  }

  private current(link: BridgeLink, agentId: string): AgentEntry | null {
    const entry = this.agents.get(agentId);
    return entry && entry.link === link ? entry : null;
  }

  private removeAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry || entry.link) return;
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
    if (viewer.bufferedAmount() > SLOW_VIEWER_BYTES) {
      entry.stale.add(viewer);
      return;
    }
    viewer.send(message);
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

  private broadcast(message: ServerToClient): void {
    for (const client of this.clients) client.send(message);
  }
}
