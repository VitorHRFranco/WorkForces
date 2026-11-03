import type { FolderInfo } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { AiIcon } from "./ai-icons";
import { FoldersModal } from "./folders-modal";
import { spawnErrorText } from "./spawn-text";

interface SpawnStatus {
  state: "pending" | "ok" | "error";
  text: string;
}

const STATUS_MS = 8_000;

/** "Chamar agente" na barra de cima: escolhe a IA e a pasta liberada neste computador. */
export function AgentMenu() {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [status, setStatus] = useState<SpawnStatus | null>(null);
  const [foldersModal, setFoldersModal] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    bridge.folders.list().then(setFolders, () => setFolders([]));
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

  const show = (next: SpawnStatus) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus(next);
    if (next.state !== "pending") timer.current = setTimeout(() => setStatus(null), STATUS_MS);
  };

  const spawn = async (alias: string) => {
    setOpen(false);
    show({ state: "pending", text: `abrindo ${alias}…` });
    try {
      const outcome = await bridge.agents.spawn(alias);
      if (outcome.ok) show({ state: "ok", text: `${alias} aberto: a janela fica minimizada na barra de tarefas` });
      else show({ state: "error", text: spawnErrorText(outcome.error) });
    } catch {
      show({ state: "error", text: spawnErrorText("spawn-failed") });
    }
  };

  const openFolders = () => {
    setOpen(false);
    setFoldersModal(true);
  };

  return (
    <div class="agent-menu" ref={root}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Chamar agente
      </button>
      {open && (
        <div class="agent-menu-list">
          <div class="ai-row">
            <button type="button" class="ai-button active" aria-label="Claude" title="Claude">
              <AiIcon ai="claude" />
            </button>
            <button type="button" class="ai-button" aria-label="Codex" title="em breve" disabled>
              <AiIcon ai="codex" disabled />
            </button>
            <button type="button" class="ai-button" aria-label="Gemini" title="em breve" disabled>
              <AiIcon ai="gemini" disabled />
            </button>
          </div>
          <ul>
            {folders.length === 0 && <li class="agent-menu-hint">Nenhuma pasta liberada ainda.</li>}
            {folders.map((folder) => (
              <li key={folder.alias}>
                <button type="button" disabled={!folder.exists} onClick={() => spawn(folder.alias)}>
                  {folder.alias}
                  {!folder.exists && " (não existe mais)"}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={openFolders}>
                Pastas…
              </button>
            </li>
          </ul>
        </div>
      )}
      {status && (
        <span class={`spawn-status ${status.state}`} role="status">
          {status.text}
        </span>
      )}
      {foldersModal && <FoldersModal onClose={() => setFoldersModal(false)} />}
    </div>
  );
}
