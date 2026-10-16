import { MIN_PASSWORD_LENGTH } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../api";
import { navigate } from "../router";

export function InvitePage({ code }: { code: string }) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.inviteStatus(code).then(
      (status) => setValid(status.valid),
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.status < 500) setValid(false);
        else setUnreachable(true);
      },
    );
  }, [code]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (password !== confirm) return setError("as senhas não conferem");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`a senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite(code, name, password);
      navigate("/", { replace: true });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const toLogin = (event: Event) => {
    event.preventDefault();
    navigate("/login");
  };

  if (unreachable) {
    return (
      <main class="card">
        <p class="error" role="alert">
          Não consegui conferir o convite. Tente de novo em instantes.
        </p>
      </main>
    );
  }
  if (valid === null) {
    return (
      <main class="card">
        <p role="status">Conferindo o convite…</p>
      </main>
    );
  }
  if (!valid) {
    return (
      <main class="card">
        <h1>WorkForces</h1>
        <p class="error" role="alert">Este convite é inválido ou já foi usado. Peça um novo a quem administra o escritório.</p>
        <a href="/login" onClick={toLogin}>
          Ir para o login
        </a>
      </main>
    );
  }
  return (
    <main class="card">
      <h1>Criar sua conta</h1>
      <form onSubmit={submit}>
        <label>
          Nome (2 a 32 letras, números, ponto, _ ou -)
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="username" autocapitalize="none" spellcheck={false} maxLength={32} required />
        </label>
        <label>
          Senha (pelo menos {MIN_PASSWORD_LENGTH} caracteres)
          <input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={200} required />
        </label>
        <label>
          Repita a senha
          <input type="password" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} autocomplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={200} required />
        </label>
        {error && <p class="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Criar conta e entrar
        </button>
      </form>
    </main>
  );
}
