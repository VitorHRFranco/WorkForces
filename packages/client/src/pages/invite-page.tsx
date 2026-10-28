import { MIN_PASSWORD_LENGTH } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../api";
import { bridge } from "../bridge";
import { navigate } from "../router";

export function InvitePage({ code }: { code: string }) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    bridge.offices.current().then(
      (current) => (current ? setHost(current.host) : navigate("/", { replace: true })),
      () => navigate("/", { replace: true }),
    );
  }, []);

  useEffect(() => {
    setValid(null);
    setUnreachable(false);
    api.inviteStatus(code).then(
      (status) => setValid(status.valid),
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.status < 500) setValid(false);
        else setUnreachable(true);
      },
    );
  }, [code, attempt]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (password !== confirm) return setError("as senhas não conferem");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`a senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite(code, name, password);
      navigate("/office", { replace: true });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (host === null) {
    return (
      <main class="card">
        <p role="status">Conferindo o convite…</p>
      </main>
    );
  }
  if (unreachable) {
    return (
      <main class="card">
        <p class="error" role="alert">
          Não consegui falar com {host}. Confira a internet ou a VPN e tente de novo.
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </button>
        <button type="button" onClick={() => navigate("/")}>
          Voltar aos escritórios
        </button>
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
        <button type="button" onClick={() => navigate("/login")}>
          Entrar com uma conta que já tenho
        </button>
        <button type="button" onClick={() => navigate("/")}>
          Voltar aos escritórios
        </button>
      </main>
    );
  }
  return (
    <main class="card">
      <h1>Criar sua conta em {host}</h1>
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
