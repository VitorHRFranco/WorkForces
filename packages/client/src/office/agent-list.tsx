import type { AgentInfo, Me } from "@workforces/protocol";
import { statusText } from "../terminal/terminal-panel";

export function AgentList({ agents, me, watching, onWatch }: { agents: AgentInfo[]; me: Me; watching: string | null; onWatch: (agentId: string) => void }) {
  if (agents.length === 0) {
    return (
      <p class="empty">
        Nenhum agente no escritório agora. Rode <code>workforces claude</code> numa máquina com login.
      </p>
    );
  }
  const sorted = [...agents].sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.label.localeCompare(b.label));
  return (
    <ul class="agents">
      {sorted.map((agent) => (
        <li key={agent.id}>
          <button type="button" class={agent.id === watching ? "agent active" : "agent"} onClick={() => onWatch(agent.id)}>
            <span class={`dot ${agent.connected ? agent.status : "offline"}`} />
            <strong>{agent.label}</strong>
            <span class="status">{statusText(agent)}</span>
            <span class="owner">{agent.ownerId === me.id ? "você" : agent.ownerName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
