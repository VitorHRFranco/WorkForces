import type { AgentInfo } from "@workforces/protocol";
import { TerminalPanel, statusText, type TerminalHandle } from "../terminal/terminal-panel";

export function DeskPanel({
  ownerName,
  agents,
  watched,
  blocked,
  handle,
  onSelect,
  onReady,
  onRetry,
  onClose,
}: {
  ownerName: string | null;
  agents: AgentInfo[];
  watched: string | null;
  /** O servidor recusou (longe demais da mesa). */
  blocked: boolean;
  handle: { current: TerminalHandle | null };
  onSelect: (agentId: string) => void;
  onReady: (agentId: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const agent = agents.find((candidate) => candidate.id === watched) ?? null;
  return (
    <section class="desk-panel" aria-label="Terminal da mesa">
      <header>
        <strong>{ownerName ? `Mesa de ${ownerName}` : "Mesa"}</strong>
        <span class="readonly">somente leitura</span>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </header>
      <nav class="tabs">
        {agents.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            class={candidate.id === watched ? "tab active" : "tab"}
            title={statusText(candidate)}
            onClick={() => onSelect(candidate.id)}
          >
            <span class={`dot ${candidate.connected ? candidate.status : "offline"}`} />
            {candidate.label}
          </button>
        ))}
      </nav>
      {agent && !blocked ? (
        <TerminalPanel
          key={agent.id}
          agentId={agent.id}
          header={
            <header>
              <strong>{agent.label}</strong>
              <span>{agent.ownerName}</span>
              <span class="muted">{statusText(agent)}</span>
              {agent.ownerAway && <span class="muted">dono fora</span>}
            </header>
          }
          handle={handle}
          onReady={() => onReady(agent.id)}
        />
      ) : (
        <div class="desk-panel-message">
          <p>Chegue mais perto da mesa para ver o terminal.</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      )}
    </section>
  );
}
