import type { LocalAgentInfo } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { TerminalPanel, type TerminalHandle } from "../terminal/terminal-panel";

/** Espera curta para juntar vários `changed` seguidos num só pedido de tela. */
const REWATCH_MS = 300;

/** "Meus agentes": os agentes deste computador no escritório aberto, com digitação. Só lê o canal local. */
export function OwnPanel({ onClose, onFocusChange }: { onClose: () => void; onFocusChange: (focused: boolean) => void }) {
  const [agents, setAgents] = useState<LocalAgentInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const activeRef = useRef<string | null>(null);

  const agent = agents === null ? null : (agents.find((candidate) => candidate.agentId === selected) ?? agents[0] ?? null);
  const active = agent?.agentId ?? null;
  activeRef.current = active;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = (rewatch: boolean) =>
      bridge.agents.list().then(
        (list) => {
          setAgents(list);
          // Depois de reconectar a um agente, o app esquece quem estava assistindo: pede de novo (uma vez por rajada).
          const id = activeRef.current;
          if (rewatch && id !== null && list.some((item) => item.agentId === id)) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (activeRef.current === id) bridge.agents.watch(id);
            }, REWATCH_MS);
          }
        },
        () => setAgents((current) => current ?? []),
      );
    void reload(false);
    const off = bridge.agents.onEvent((event) => {
      if (event.type === "changed") void reload(true);
      else if (event.type === "frame" && event.agentId === handle.current?.agentId) {
        if (handle.current.apply(event.frame) === "gap") {
          // Quadro-chave novo: o apply já espaça os pedidos.
          bridge.agents.unwatch(event.agentId);
          bridge.agents.watch(event.agentId);
        }
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Trocar de aba ou fechar o painel para de receber quadros daquele agente.
  useEffect(() => {
    if (active === null) return;
    return () => bridge.agents.unwatch(active);
  }, [active]);

  // Painel fechado com o terminal em foco devolve o teclado ao jogo.
  useEffect(() => () => onFocusChange(false), []);

  return (
    <section class="desk-panel" aria-label="Meus agentes">
      <header>
        <strong>Meus agentes</strong>
        <span class="readonly">você digita aqui</span>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </header>
      {agents !== null && agents.length > 0 && (
        <nav class="tabs">
          {agents.map((candidate) => (
            <button
              type="button"
              key={candidate.agentId}
              class={candidate.agentId === active ? "tab active" : "tab"}
              onClick={() => setSelected(candidate.agentId)}
            >
              <span class={`dot ${candidate.state}`} />
              {candidate.label}
            </button>
          ))}
        </nav>
      )}
      {agent ? (
        <TerminalPanel
          key={agent.agentId}
          agentId={agent.agentId}
          header={
            <header>
              <strong>{agent.label}</strong>
              <span class="muted">{agent.state === "working" ? "trabalhando" : "parado"}</span>
            </header>
          }
          handle={handle}
          onReady={() => bridge.agents.watch(agent.agentId)}
          onInput={(data) => bridge.agents.input(agent.agentId, data)}
          onFocusChange={onFocusChange}
        />
      ) : (
        agents !== null && (
          <div class="desk-panel-message">
            <p>Nenhum agente seu aberto neste escritório. Use Chamar agente.</p>
          </div>
        )
      )}
    </section>
  );
}
