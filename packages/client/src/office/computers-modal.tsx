import type { TokenInfo } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { api, errorText } from "../api";
import { formatDate } from "../format";
import { Modal } from "./modal";

export function ComputersModal({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.listTokens().then(setTokens, (failure: unknown) => setError(errorText(failure)));

  useEffect(() => {
    void reload();
  }, []);

  const revoke = async (token: TokenInfo) => {
    if (!confirm(`Revogar o acesso "${token.name}"? Os agentes desse computador saem do escritório.`)) return;
    setError(null);
    try {
      await api.revokeToken(token.id);
      await reload();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <Modal title="Computadores" onClose={onClose}>
      <p class="muted">
        Cada computador com o app recebe um acesso próprio. Revogue o de um computador perdido; o app cria outro quando você chamar um agente.
      </p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <ul class="tokens">
        {tokens.map((token) => (
          <li key={token.id}>
            <span>{token.name}</span>
            <button type="button" onClick={() => revoke(token)}>
              Revogar
            </button>
            <span class="muted">
              criado em {formatDate(token.createdAt)} · {token.lastUsedAt ? `usado em ${formatDate(token.lastUsedAt)}` : "nunca usado"}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
