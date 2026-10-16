import type { TokenCreated, TokenInfo } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { api, errorText } from "../api";
import { formatDate } from "../format";
import { CopyField } from "./copy-field";
import { Modal } from "./modal";

export function TokensModal({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<TokenCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    api.listTokens().then(setTokens, (failure: unknown) => setError(errorText(failure)));

  useEffect(() => {
    void reload();
  }, []);

  const create = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setCreated(await api.createToken(name));
      setName("");
      await reload();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: TokenInfo) => {
    if (!confirm(`Revogar o token "${token.name}"? Os agentes dessa máquina saem do escritório.`)) return;
    setError(null);
    try {
      await api.revokeToken(token.id);
      await reload();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <Modal title="Tokens da ponte" onClose={onClose}>
      <p class="muted">
        Cada máquina usa um token para ligar o <code>workforces claude</code> ao escritório. Revogue o token de uma máquina que você não usa
        mais: os agentes dela caem na hora e saem do escritório em até 30 s.
      </p>
      {created && (
        <div class="created">
          <p>
            <strong>Copie agora:</strong> este token não aparece de novo.
          </p>
          <CopyField key={created.token} value={created.token} />
          <p>
            Na sua máquina, rode <code>workforces login {location.origin}</code> e cole o token quando ele pedir.
          </p>
        </div>
      )}
      <form class="inline" onSubmit={create}>
        <input placeholder="nome da máquina (ex.: notebook)" value={name} maxLength={40} onInput={(e) => setName(e.currentTarget.value)} required />
        <button type="submit" disabled={busy}>Criar token</button>
      </form>
      {error && <p class="error" role="alert">{error}</p>}
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
