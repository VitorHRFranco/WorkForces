import type { AgentInfo, Me } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../api";
import { AgentList } from "../office/agent-list";
import { OfficeConnection } from "../office/connection";
import { InviteModal } from "../office/invite-modal";
import { TokensModal } from "../office/tokens-modal";
import { navigate } from "../router";
import { TerminalPanel, type TerminalHandle } from "../terminal/terminal-panel";

export function OfficePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [watching, setWatching] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"tokens" | "invite" | null>(null);
  const connection = useRef<OfficeConnection | null>(null);
  const terminal = useRef<TerminalHandle | null>(null);
  const watchingRef = useRef<string | null>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    setMeFailed(false);
    api.me().then(setMe, (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 401) navigate("/login", { replace: true });
      else setMeFailed(true);
    });
  }, [attempt]);

  useEffect(() => {
    if (!me) return;
    const end = (text: string) => {
      endedRef.current = true;
      setNotice(text);
    };
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
            // Só "gap" pede a tela de novo (o apply já espaça os pedidos). Antes de o painel montar, os
            // quadros são descartados; o painel pede a tela ao montar (onReady).
            if (message.agentId === watchingRef.current && terminal.current?.agentId === message.agentId && terminal.current.apply(message) === "gap") {
              conn.watch(message.agentId);
            }
            break;
        }
      },
      onStatus: (status) => {
        if (endedRef.current) return;
        setNotice(status === "reconnecting" ? "Reconectando ao escritório…" : null);
      },
      onEnd: (reason) => {
        if (reason === "unauthorized") navigate("/login", { replace: true });
        else if (reason === "outdated") end("O escritório foi atualizado. Recarregue a página.");
        else end("O escritório foi aberto em outra aba. Recarregue esta página para usá-lo aqui.");
      },
    });
    connection.current = conn;
    conn.start();
    return () => {
      conn.stop();
      connection.current = null;
    };
  }, [me]);

  // Só guarda o agente escolhido: quem pede a tela é o onReady do painel, que monta de novo a cada agente.
  const watch = (agentId: string) => {
    if (endedRef.current) return;
    watchingRef.current = agentId;
    setWatching(agentId);
    setNotice(null);
  };

  const stopWatching = () => {
    watchingRef.current = null;
    setWatching(null);
    connection.current?.unwatch();
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (failure) {
      // A sessão continua válida no servidor: não navega.
      setNotice(errorText(failure));
      return;
    }
    navigate("/login", { replace: true });
  };

  if (meFailed) {
    return (
      <div class="card">
        <p class="error" role="alert">
          Não consegui falar com o escritório.
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!me) {
    return (
      <p class="loading" role="status">
        Carregando…
      </p>
    );
  }
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
      {notice && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}
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
