import type { CurrentOffice } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { api, errorText } from "../api";
import { bridge } from "../bridge";
import { navigate } from "../router";

export function LoginPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [office, setOffice] = useState<CurrentOffice | null>(null);

  useEffect(() => {
    bridge.offices.current().then(
      (current) => (current ? setOffice(current) : navigate("/", { replace: true })),
      () => navigate("/", { replace: true }),
    );
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(name, password);
      navigate("/office", { replace: true });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!office) return <p class="loading" role="status">Carregando…</p>;

  return (
    <main class="card">
      <h1>Entrar em {office.host}</h1>
      {office.sessionExpired && (
        <p class="notice" role="status">
          Sua sessão expirou. Entre de novo.
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          Nome
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="username" autocapitalize="none" spellcheck={false} required />
        </label>
        <label>
          Senha
          <input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" required />
        </label>
        {error && <p class="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Entrar
        </button>
      </form>
      <button type="button" onClick={() => navigate("/")}>
        Voltar aos escritórios
      </button>
    </main>
  );
}
