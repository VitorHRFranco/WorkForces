import type { FolderInfo } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { Modal } from "./modal";

export function FoldersModal({ onClose }: { onClose: () => void }) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge.folders.list().then(setFolders, () => setError("não consegui ler as pastas; tente de novo"));
  }, []);

  const pick = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const change = await bridge.folders.pickAndAdd(alias);
      if (change === null) return; // cancelou o seletor: nada muda
      if (change.ok) {
        setFolders(change.folders);
        setAlias("");
      } else {
        setError(change.error);
      }
    } catch {
      setError("não consegui liberar a pasta; tente de novo");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (folder: FolderInfo) => {
    setError(null);
    try {
      setFolders(await bridge.folders.remove(folder.alias));
    } catch {
      setError("não consegui remover a pasta; tente de novo");
    }
  };

  return (
    <Modal title="Pastas liberadas" onClose={onClose}>
      <p class="muted">Só estas pastas podem ser abertas por Chamar agente. O escritório nunca vê os caminhos.</p>
      <ul class="tokens">
        {folders.map((folder) => (
          <li key={folder.alias}>
            <span>
              {folder.alias} → {folder.path}
              {!folder.exists && " (não existe mais)"}
            </span>
            <button type="button" onClick={() => remove(folder)}>
              Remover
            </button>
          </li>
        ))}
      </ul>
      <form class="inline" onSubmit={pick}>
        <input placeholder="Apelido" aria-label="Apelido" value={alias} maxLength={32} onInput={(e) => setAlias(e.currentTarget.value)} required />
        <button type="submit" disabled={busy}>
          Escolher pasta…
        </button>
      </form>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
