import type { InviteCreated } from "@workforces/protocol";
import { useState } from "preact/hooks";
import { api, errorText } from "../api";
import { formatDate } from "../format";
import { CopyField } from "./copy-field";
import { Modal } from "./modal";

export function InviteModal({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState<InviteCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      setInvite(await api.createInvite());
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <Modal title="Gerar convite" onClose={onClose}>
      <p class="muted">O convite vale por 7 dias e só pode ser usado uma vez. Mande o link para a pessoa por um canal privado.</p>
      {invite ? (
        <>
          <CopyField value={invite.url} />
          {/* O link do app (com o pino) não abre no navegador: em chat que não o deixa clicável, ele é colado no app. */}
          {invite.url.startsWith("workforces://") && (
            <p class="muted">Se o link não ficar clicável no chat, a pessoa cola em "Entrar com convite" no app do WorkForces.</p>
          )}
          <p class="muted">Expira em {formatDate(invite.expiresAt)}.</p>
        </>
      ) : (
        <button type="button" onClick={create}>
          Gerar link de convite
        </button>
      )}
      {error && <p class="error" role="alert">{error}</p>}
    </Modal>
  );
}
