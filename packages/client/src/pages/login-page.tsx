import { useState } from "preact/hooks";
import { api, errorText } from "../api";
import { navigate } from "../router";

export function LoginPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(name, password);
      navigate("/", { replace: true });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="card">
      <h1>WorkForces</h1>
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
    </main>
  );
}
