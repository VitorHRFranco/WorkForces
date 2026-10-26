import { parseOfficeMap, type Me, type OfficeMap } from "@workforces/protocol";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../api";
import { GameView } from "../game/game-view";
import { MoveSender } from "../game/move-sender";
import type { OfficeSceneDeps } from "../game/office-scene";
import { useTyping } from "../game/typing";
import { AgentMenu, type SpawnStatus } from "../office/agent-menu";
import { OfficeConnection, SPAWN_COOLDOWN_MS } from "../office/connection";
import { ChatBox } from "../office/chat-box";
import { DeskPanel } from "../office/desk-panel";
import { InviteModal } from "../office/invite-modal";
import { spawnErrorText } from "../office/spawn-text";
import { OfficeState, useOfficeVersion } from "../office/office-state";
import { TokensModal } from "../office/tokens-modal";
import { watchTarget } from "../office/watch-target";
import type { TerminalHandle } from "../terminal/terminal-panel";
import { navigate } from "../router";

interface LoadedMap {
  map: OfficeMap;
  json: unknown;
}

export function OfficePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [office, setOffice] = useState<LoadedMap | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"tokens" | "invite" | null>(null);
  const state = useMemo(() => new OfficeState(), []);
  useOfficeVersion(state);
  const connection = useRef<OfficeConnection | null>(null);
  const endedRef = useRef(false);
  const moves = useMemo(() => new MoveSender((move) => connection.current?.move(move.x, move.y, move.dir, move.moving) ?? false, () => performance.now()), []);
  const typing = useTyping();
  const [zone, setZone] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const terminal = useRef<TerminalHandle | null>(null);
  const watchingRef = useRef<string | null>(null);
  const [spawnStatus, setSpawnStatus] = useState<SpawnStatus | null>(null);
  const [spawnBusy, setSpawnBusy] = useState(false);
  /** O pedido de agente que espera resposta (a resposta traz o mesmo reqId). */
  const pendingSpawn = useRef<{ reqId: string; alias: string } | null>(null);

  useEffect(() => {
    setLoadFailed(false);
    api.me().then(setMe, (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 401) navigate("/login", { replace: true });
      else setLoadFailed(true);
    });
    api
      .map()
      .then((json) => setOffice({ map: parseOfficeMap(json), json }))
      .catch(() => setLoadFailed(true));
  }, [attempt]);

  useEffect(() => {
    if (!me) return;
    const end = (text: string) => {
      endedRef.current = true;
      setNotice(text);
    };
    const conn = new OfficeConnection({
      onMessage: (message) => {
        state.apply(message);
        if (message.type === "spawnResult") {
          const pending = pendingSpawn.current;
          if (pending?.reqId !== message.reqId) return;
          pendingSpawn.current = null;
          setSpawnStatus(
            message.ok
              ? { state: "ok", text: `abrindo ${pending.alias}: a janela aparece no seu computador` }
              : { state: "error", text: spawnErrorText(message.error ?? "spawn-failed") },
          );
          return;
        }
        if (message.type === "welcome") {
          // Pedido feito antes de a conexão cair: a resposta não vem mais.
          if (pendingSpawn.current) {
            pendingSpawn.current = null;
            setSpawnStatus({ state: "error", text: "a conexão caiu antes da resposta; confira se a janela abriu" });
          }
          // Depois de reconectar, o servidor não sabe onde o avatar está: manda a posição antes de voltar a assistir.
          moves.resend();
          if (watchingRef.current) conn.watch(watchingRef.current);
        } else if (message.type === "watchEnded" && message.agentId === watchingRef.current && message.reason === "left-zone") {
          setBlocked(message.agentId);
        } else if (
          message.type === "frame" &&
          message.agentId === watchingRef.current &&
          terminal.current?.agentId === message.agentId &&
          terminal.current.apply(message) === "gap"
        ) {
          // Só "gap" pede a tela de novo (o apply já espaça os pedidos).
          conn.watch(message.agentId);
        }
      },
      onStatus: (status) => {
        if (endedRef.current) return;
        setNotice(status === "reconnecting" ? "Reconectando ao escritório…" : null);
      },
      onEnd: (reason) => {
        if (reason === "unauthorized") navigate("/login", { replace: true });
        else if (reason === "outdated") end("O escritório foi atualizado. Recarregue a página.");
        else if (reason === "origin") end("Este endereço não é o do escritório. Abra-o pelo endereço configurado em WF_PUBLIC_URL.");
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

  // Estável durante a vida da página: a cena lê o estado direto do OfficeState.
  const sceneDeps = useMemo<OfficeSceneDeps | null>(
    () =>
      office && {
        state,
        map: office.map,
        tiledJson: office.json,
        tilesUrl: `/map/${office.map.tilesetImage}`,
        onMove: (move) => moves.update(move),
        onZone: setZone,
      },
    [office],
  );

  // Ao trocar de mesa (ou sair de todas), recomeça: sem aba escolhida, sem recusa, painel não fechado.
  useEffect(() => {
    setSelected(null);
    setBlocked(null);
    setDismissed(null);
  }, [zone]);

  // Mesa fechada não abre o painel (spec 9, regra 3); se fechar durante a visita, o painel some.
  const zoneClosed = zone !== null && state.desks.get(zone)?.closed === true;
  const deskAgents = zone !== null && zone !== dismissed && !zoneClosed && !endedRef.current ? state.agentsAtDesk(zone) : [];
  const watched = watchTarget(deskAgents, selected);
  const isBlocked = watched !== null && blocked === watched;

  // Fixa a aba quando o painel abre: um agente novo na mesa não troca o terminal no meio da visita.
  useEffect(() => {
    if (selected === null && watched !== null) setSelected(watched);
  }, [selected, watched]);

  // O servidor só deixa de mandar quadros com `unwatch` (ou quando percebe que saímos da zona).
  useEffect(() => {
    const previous = watchingRef.current;
    watchingRef.current = isBlocked ? null : watched;
    if (previous !== null && watchingRef.current === null) connection.current?.unwatch();
  }, [watched, isBlocked]);

  // Botão clicado com o mouse não fica com o foco: o Enter seguinte abre o chat em vez de repetir o clique, e o Espaço não aperta
  // o botão de novo. Clique vindo do teclado (detail 0) mantém o foco; os modais cuidam do próprio foco.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.detail === 0) return;
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button && !button.closest(".modal") && document.activeElement === button) button.blur();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // O aviso some sozinho depois de um tempo (menos enquanto espera a resposta).
  useEffect(() => {
    if (!spawnStatus || spawnStatus.state === "pending") return;
    const timer = window.setTimeout(() => setSpawnStatus(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [spawnStatus]);

  const spawnAgent = (alias: string) => {
    const request = connection.current?.spawnAgent(alias) ?? ({ ok: false, reason: "offline" } as const);
    if (!request.ok) {
      setSpawnStatus({ state: "error", text: request.reason === "cooldown" ? spawnErrorText("rate-limited") : "sem conexão com o escritório" });
      return;
    }
    pendingSpawn.current = { reqId: request.reqId, alias };
    setSpawnStatus({ state: "pending", text: `pedindo ${alias} à sua ponte…` });
    setSpawnBusy(true);
    window.setTimeout(() => setSpawnBusy(false), SPAWN_COOLDOWN_MS);
  };

  const startWatching = (agentId: string) => {
    moves.flush(); // a posição chega ao servidor antes do watch (regra de proximidade)
    connection.current?.watch(agentId);
  };

  const closeModal = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    setModal(null);
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

  if (loadFailed) {
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
  if (!me || !sceneDeps || !state.me) {
    return (
      <p class={notice ? "notice" : "loading"} role="status">
        {notice ?? "Carregando…"}
      </p>
    );
  }

  const myDesk = state.me.deskId === null ? undefined : state.desks.get(state.me.deskId);

  return (
    <div class="office">
      <header class="topbar">
        <strong>WorkForces</strong>
        <span class="who">{me.name}</span>
        <span class="online">{state.players.size === 1 ? "1 pessoa online" : `${state.players.size} pessoas online`}</span>
        <AgentMenu aliases={state.aliases} listenerOnline={state.listenerOnline} busy={spawnBusy} status={spawnStatus} onSpawn={spawnAgent} />
        {myDesk && (
          <button
            type="button"
            class={myDesk.closed ? "desk-toggle closed" : "desk-toggle"}
            title={
              myDesk.closed
                ? "Ninguém vê o terminal dos seus agentes. Clique para abrir."
                : "Quem chega perto vê o terminal dos seus agentes. Clique para fechar."
            }
            onClick={() => connection.current?.setDeskClosed(!myDesk.closed)}
          >
            {myDesk.closed ? "Mesa: fechada" : "Mesa: aberta"}
          </button>
        )}
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
      {state.me.deskId === null && (
        <p class="notice" role="status">
          Não há mesa livre para você: peça a quem administra o escritório para ampliar o mapa. Seus agentes não aparecem no mapa.
        </p>
      )}
      <main class="stage">
        <GameView deps={sceneDeps} keyboardEnabled={!typing && modal === null && !endedRef.current} panelOpen={deskAgents.length > 0} />
        {deskAgents.length > 0 && (
          <DeskPanel
            ownerName={state.desks.get(zone!)?.ownerName ?? null}
            agents={deskAgents}
            watched={watched}
            blocked={isBlocked}
            handle={terminal}
            onSelect={(agentId) => {
              setSelected(agentId);
              setBlocked(null);
            }}
            onReady={startWatching}
            onRetry={() => setBlocked(null)}
            onClose={() => setDismissed(zone)}
          />
        )}
        <ChatBox messages={state.chat} onSend={(text) => connection.current?.chat(text) ?? false} />
      </main>
      {modal === "tokens" && <TokensModal onClose={closeModal} />}
      {modal === "invite" && <InviteModal onClose={closeModal} />}
    </div>
  );
}
