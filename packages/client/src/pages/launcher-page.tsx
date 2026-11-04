import type { AppRoute, OfficeSummary } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { takeFlash } from "../flash";
import { navigate, routePath } from "../router";

type Reach = "checking" | "up" | "down";

const reachText: Record<Reach, string> = { checking: "conferindo…", up: "no ar", down: "fora do ar · se o endereço mudou, use \"Trocar endereço\"" };

export function LauncherPage() {
  const [offices, setOffices] = useState<OfficeSummary[] | null>(null);
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const [flash, setFlashText] = useState<string | null>(() => takeFlash());
  const [invite, setInvite] = useState("");
  const [showAddress, setShowAddress] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");

  const load = () =>
    bridge.offices.list().then(
      (list) => {
        setOffices(list);
        for (const office of list) {
          setReach((current) => ({ ...current, [office.id]: "checking" }));
          bridge.offices.reachable(office.id).then(
            (up) => setReach((current) => ({ ...current, [office.id]: up ? "up" : "down" })),
            () => setReach((current) => ({ ...current, [office.id]: "down" })),
          );
        }
      },
      () => {
        setOffices([]);
        setFlashText("não consegui ler os escritórios salvos");
      },
    );

  useEffect(() => {
    void load();
  }, []);

  /** Rota de launcher com aviso mostra o aviso aqui mesmo; as outras rotas levam à tela delas. */
  const follow = (route: AppRoute) => {
    if (route.page === "launcher") setFlashText(route.notice ?? null);
    else navigate(routePath(route));
  };

  const run = async (action: () => Promise<AppRoute>) => {
    setFlashText(null);
    setBusy(true);
    try {
      follow(await action());
    } catch {
      setFlashText("não consegui fazer isso. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  const forget = async (office: OfficeSummary) => {
    setFlashText(null);
    try {
      await bridge.offices.forget(office.id);
    } catch {
      setFlashText("não consegui esquecer este escritório. Tente de novo.");
    }
    await load();
  };

  const submitChange = async (event: Event, office: OfficeSummary) => {
    event.preventDefault();
    setFlashText(null);
    try {
      const result = await bridge.offices.changeAddress(office.id, newAddress);
      if (result.ok) {
        setChanging(null);
        await load();
      } else setFlashText(result.error);
    } catch {
      setFlashText("não consegui trocar o endereço. Tente de novo.");
    }
  };

  const submitInvite = (event: Event) => {
    event.preventDefault();
    void run(() => bridge.invites.open(invite));
  };

  const submitAddress = (event: Event) => {
    event.preventDefault();
    void run(() => bridge.offices.add(address));
  };

  return (
    <main class="card launcher">
      <h1>WorkForces</h1>
      {flash && (
        <p class="error" role="alert">
          {flash}
        </p>
      )}
      <h2>Seus escritórios</h2>
      {offices && offices.length === 0 && <p class="muted">Nenhum escritório ainda. Entre com o convite que você recebeu.</p>}
      <ul class="offices">
        {(offices ?? []).map((office) => (
          <li key={office.id}>
            <div>
              <strong>{office.host}</strong>
              <span class="muted">{office.userName ? `como ${office.userName}` : "sem conta salva"}</span>
              <span class="muted">{reachText[reach[office.id] ?? "checking"]}</span>
            </div>
            <button type="button" aria-label={`Entrar em ${office.host}`} disabled={busy} onClick={() => void run(() => bridge.offices.open(office.id))}>
              Entrar
            </button>
            <button type="button" aria-label={`Esquecer ${office.host}`} onClick={() => void forget(office)}>
              Esquecer
            </button>
            <button
              type="button"
              aria-label={`Trocar o endereço de ${office.host}`}
              onClick={() => {
                setNewAddress("");
                setChanging(office.id);
              }}
            >
              Trocar endereço
            </button>
            {changing === office.id && (
              <form onSubmit={(event) => void submitChange(event, office)}>
                <label>
                  Novo endereço
                  <input value={newAddress} onInput={(e) => setNewAddress(e.currentTarget.value)} autocapitalize="none" spellcheck={false} required />
                </label>
                <button type="submit">Salvar</button>
                <button type="button" onClick={() => setChanging(null)}>
                  Cancelar
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={submitInvite}>
        <label>
          Link do convite
          <input value={invite} onInput={(e) => setInvite(e.currentTarget.value)} autocapitalize="none" spellcheck={false} required />
        </label>
        <button type="submit" disabled={busy}>
          Entrar com convite
        </button>
      </form>
      {showAddress ? (
        <form onSubmit={submitAddress}>
          <label>
            Endereço do escritório
            <input value={address} onInput={(e) => setAddress(e.currentTarget.value)} autocapitalize="none" spellcheck={false} required />
          </label>
          <button type="submit" disabled={busy}>
            Continuar
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setShowAddress(true)}>
          Já tenho conta
        </button>
      )}
      <button type="button" disabled>
        Criar escritório (em breve)
      </button>
    </main>
  );
}
