import { parseOfficeMap, type Me, type OfficeMap } from "@workforces/protocol";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../api";
import { GameView } from "../game/game-view";
import { MoveSender } from "../game/move-sender";
import type { OfficeSceneDeps } from "../game/office-scene";
import { useTyping } from "../game/typing";
import { OfficeConnection } from "../office/connection";
import { InviteModal } from "../office/invite-modal";
import { OfficeState, useOfficeVersion } from "../office/office-state";
import { TokensModal } from "../office/tokens-modal";
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
  const moves = useMemo(() => new MoveSender((move) => connection.current?.move(move.x, move.y, move.dir, move.moving), () => performance.now()), []);
  const typing = useTyping();

  useEffect(() => {
    setLoadFailed(false);
    api.me().then(setMe, (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 401) navigate("/login", { replace: true });
      else setLoadFailed(true);
    });
    api.map().then(
      (json) => setOffice({ map: parseOfficeMap(json), json }),
      () => setLoadFailed(true),
    );
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
        // Depois de reconectar, o servidor não sabe onde o avatar está.
        if (message.type === "welcome") moves.resend();
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
        onZone: () => {},
      },
    [office],
  );

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
      <p class="loading" role="status">
        Carregando…
      </p>
    );
  }

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
      <main class="stage">
        <GameView deps={sceneDeps} keyboardEnabled={!typing && modal === null && !endedRef.current} />
      </main>
      {modal === "tokens" && <TokensModal onClose={() => setModal(null)} />}
      {modal === "invite" && <InviteModal onClose={() => setModal(null)} />}
    </div>
  );
}
