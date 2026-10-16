import type { AgentInfo, Me } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { AgentList } from "../office/agent-list";
import { OfficeConnection } from "../office/connection";
import { InviteModal } from "../office/invite-modal";
import { TokensModal } from "../office/tokens-modal";
import { navigate } from "../router";
import { TerminalPanel, type TerminalHandle } from "../terminal/terminal-panel";

export function OfficePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [watching, setWatching] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"tokens" | "invite" | null>(null);
  const connection = useRef<OfficeConnection | null>(null);
  const terminal = useRef<TerminalHandle | null>(null);
  const watchingRef = useRef<string | null>(null);

  useEffect(() => {
    api.me().then(setMe, () => navigate("/login"));
  }, []);

  useEffect(() => {
    if (!me) return;
    const conn = new OfficeConnection({
      onMessage: (message) => {
        switch (message.type) {
          case "welcome":
            setAgents(message.agents);
            if (watchingRef.current) conn.watch(watchingRef.current);
            break;
          case "agentAdded":
            setAgents((list) => [...list.filter((agent) => agent.id !== message.agent.id), message.agent]);
            break;
          case "agentUpdated":
            setAgents((list) => list.map((agent) => (agent.id === message.agent.id ? message.agent : agent)));
            break;
          case "agentRemoved":
            setAgents((list) => list.filter((agent) => agent.id !== message.agentId));
            break;
          case "watchEnded":
            if (watchingRef.current === message.agentId) {
              watchingRef.current = null;
              setWatching(null);
              setNotice("O agente saiu do escritório.");
            }
            break;
          case "frame":
            // Quadro perdido: pede a tela inteira de novo. Antes de o painel montar, os quadros são
            // descartados; o painel pede a tela ao montar (onReady).
            if (message.agentId === watchingRef.current && terminal.current?.apply(message) === "gap") conn.watch(message.agentId);
            break;
        }
      },
      onStatus: (status) => setNotice(status === "reconnecting" ? "Reconectando ao escritório…" : null),
      onEnd: (reason) => {
        if (reason === "unauthorized") navigate("/login");
        else setNotice("O escritório foi aberto em outra aba. Recarregue esta página para usá-lo aqui.");
      },
    });
    connection.current = conn;
    conn.start();
    return () => {
      conn.stop();
      connection.current = null;
    };
  }, [me]);

  const watch = (agentId: string) => {
    watchingRef.current = agentId;
    setWatching(agentId);
    setNotice(null);
    connection.current?.watch(agentId);
  };

  const stopWatching = () => {
    watchingRef.current = null;
    setWatching(null);
    connection.current?.unwatch();
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    navigate("/login");
  };

  if (!me) return <p class="loading">Carregando…</p>;
  const watched = agents.find((agent) => agent.id === watching) ?? null;

  return (
    <div class="office">
      <header class="topbar">
        <strong>WorkForces</strong>
        <span class="who">{me.name}</span>
        <span class="spacer" />
        <button type="button" onClick={() => setModal("tokens")}>
          Tokens da ponte
        </button>
        {me.isAdmin && (
          <button type="button" onClick={() => setModal("invite")}>
            Gerar convite
          </button>
        )}
        <button type="button" onClick={logout}>
          Sair
        </button>
      </header>
      {notice && <p class="notice">{notice}</p>}
      <main class="content">
        <aside class="sidebar">
          <h2>Agentes</h2>
          <AgentList agents={agents} me={me} watching={watching} onWatch={watch} />
        </aside>
        {watched ? (
          <TerminalPanel agent={watched} handle={terminal} onReady={() => connection.current?.watch(watched.id)} onClose={stopWatching} />
        ) : (
          <section class="panel placeholder">
            <p>Escolha um agente para ver o terminal dele ao vivo.</p>
          </section>
        )}
      </main>
      {modal === "tokens" && <TokensModal onClose={() => setModal(null)} />}
      {modal === "invite" && <InviteModal onClose={() => setModal(null)} />}
    </div>
  );
}
