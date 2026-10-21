import { useEffect, useRef, useState } from "preact/hooks";

export interface SpawnStatus {
  state: "pending" | "ok" | "error";
  text: string;
}

/** "Chamar agente" na barra de cima (spec 8): lista as pastas liberadas; desligado com a dica quando a ponte não está rodando. */
export function AgentMenu({
  aliases,
  listenerOnline,
  busy,
  status,
  onSpawn,
}: {
  aliases: string[];
  listenerOnline: boolean;
  /** Logo depois de um pedido: a espera de 5 s do servidor ainda não passou. */
  busy: boolean;
  status: SpawnStatus | null;
  onSpawn(alias: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!listenerOnline) setOpen(false);
  }, [listenerOnline]);

  return (
    <div class="agent-menu" ref={root}>
      <button type="button" disabled={!listenerOnline} aria-expanded={open} onClick={() => setOpen(!open)}>
        Chamar agente
      </button>
      {!listenerOnline && (
        <span class="agent-menu-hint">
          rode <code>workforces ponte</code>
        </span>
      )}
      {open && (
        <ul class="agent-menu-list">
          {aliases.length === 0 ? (
            <li class="agent-menu-hint">
              nenhuma pasta liberada: <code>workforces pastas add &lt;caminho&gt; --nome &lt;apelido&gt;</code>
            </li>
          ) : (
            aliases.map((alias) => (
              <li key={alias}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    onSpawn(alias);
                  }}
                >
                  {alias}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {status && (
        <span class={`spawn-status ${status.state}`} role="status">
          {status.text}
        </span>
      )}
    </div>
  );
}
