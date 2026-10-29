import { LIMITS, type AgentInfo, type ChatEntry, type DeskInfo, type PlayerInfo, type ServerToClient, type WelcomeMe } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";

/** Ordem dos agentes numa mesa: rótulo, depois id (para empate). */
export function compareAgents(a: AgentInfo, b: AgentInfo): number {
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/** Tudo o que o escritório mostra, montado a partir das mensagens do servidor. Não sabe nada de tela. */
export class OfficeState {
  me: WelcomeMe | null = null;
  readonly players = new Map<number, PlayerInfo>();
  readonly agents = new Map<string, AgentInfo>();
  readonly desks = new Map<string, DeskInfo>();
  chat: ChatEntry[] = [];
  /** Muda a cada atualização (a interface usa para saber que precisa redesenhar). */
  version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(message: ServerToClient): void {
    switch (message.type) {
      case "welcome":
        this.me = message.me;
        this.players.clear();
        for (const player of message.players) this.players.set(player.id, player);
        this.agents.clear();
        for (const agent of message.agents) this.agents.set(agent.id, agent);
        this.desks.clear();
        for (const desk of message.desks) this.desks.set(desk.id, desk);
        this.chat = message.chat.slice(-LIMITS.chatHistory);
        break;
      case "playerJoined":
        this.players.set(message.player.id, message.player);
        break;
      case "playerLeft":
        this.players.delete(message.playerId);
        break;
      case "playerMoved": {
        const player = this.players.get(message.playerId);
        if (!player) return;
        this.players.set(player.id, { ...player, x: message.x, y: message.y, dir: message.dir, moving: message.moving });
        break;
      }
      case "agentAdded":
      case "agentUpdated":
        this.agents.set(message.agent.id, message.agent);
        break;
      case "agentRemoved":
        this.agents.delete(message.agentId);
        break;
      case "deskUpdated": {
        const { desk } = message;
        this.desks.set(desk.id, desk);
        if (this.me && desk.ownerId === this.me.id) this.me = { ...this.me, deskId: desk.id };
        else if (this.me && this.me.deskId === desk.id) this.me = { ...this.me, deskId: null };
        break;
      }
      case "chat": {
        const { type: _type, ...entry } = message;
        this.chat = [...this.chat, entry].slice(-LIMITS.chatHistory);
        break;
      }
      default:
        return; // frame, watchEnded e spawnResult são tratados pela página
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Agentes do dono da mesa, na ordem do rótulo. */
  agentsAtDesk(deskId: string): AgentInfo[] {
    const ownerId = this.desks.get(deskId)?.ownerId;
    if (ownerId == null) return [];
    return [...this.agents.values()].filter((agent) => agent.ownerId === ownerId).sort(compareAgents);
  }
}

/** Re-renderiza o componente quando o estado do escritório muda. */
export function useOfficeVersion(state: OfficeState): number {
  const [version, setVersion] = useState(state.version);
  useEffect(() => state.subscribe(() => setVersion(state.version)), [state]);
  return version;
}
