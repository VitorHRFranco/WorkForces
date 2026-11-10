import type { AppRoute, OfficeSummary } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { takeFlash } from "../flash";
import { navigate, routePath } from "../router";
import { AddressChangedNotice, hostStateText, useHostStatus } from "./host-page";

type Reach = "checking" | "up" | "down";

const reachText: Record<Reach, string> = { checking: "conferindo…", up: "no ar", down: "fora do ar" };

/** A dica de trocar o endereço só vale para escritório com pino: sem ele, o app não deixa trocar. */
const reachLine = (reach: Reach, pinned: boolean): string =>
  reach === "down" && pinned ? `${reachText.down} · se o endereço mudou, use "Trocar endereço"` : reachText[reach];

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
  const [host, setHost] = useHostStatus(
    () => {},
    () => setFlashText("não consegui ler o escritório deste computador"),
  );

  const load = () =>
    bridge.offices.list().then(
      (list) => {
        setOffices(list);
        // O escritório deste computador fica na seção dele, e não na lista comum.
        for (const office of list.filter((entry) => !entry.hosted)) {
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

  const stopHost = async () => {
    setFlashText(null);
    try {
      setHost(await bridge.host.stop());
    } catch {
      setFlashText("não consegui desligar o escritório. Tente de novo.");
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

  const common = offices?.filter((office) => !office.hosted) ?? null;

  return (
    <main class="card launcher">
      <h1>WorkForces</h1>
      {flash && (
        <p class="error" role="alert">
          {flash}
        </p>
      )}
      <h2>Neste computador</h2>
      {host && !host.created && (
        <button type="button" onClick={() => navigate("/host")}>
          Criar escritório
        </button>
      )}
      {host?.created && (
        <ul class="offices">
          <li>
            <div>
              <strong>Seu escritório</strong>
              <span class="muted">{hostStateText(host)}</span>
              {host.error && host.error !== flash && <span class="error">{host.error}</span>}
            </div>
            <button
              type="button"
              disabled={busy || host.state === "starting" || host.state === "stopping"}
              onClick={() => void run(() => bridge.host.enter())}
            >
              {host.state === "on" ? "Entrar" : "Ligar e entrar"}
            </button>
            {host.state === "on" && (
              <button type="button" onClick={() => void stopHost()}>
                Desligar
              </button>
            )}
            <button type="button" onClick={() => navigate("/host")}>
              Configurar
            </button>
          </li>
        </ul>
      )}
      {host && <AddressChangedNotice status={host} />}
      <h2>Seus escritórios</h2>
      {common && common.length === 0 && <p class="muted">Nenhum escritório ainda. Entre com o convite que você recebeu.</p>}
      <ul class="offices">
        {(common ?? []).map((office) => (
          <li key={office.id}>
            <div>
              <strong>{office.host}</strong>
              <span class="muted">{office.userName ? `como ${office.userName}` : "sem conta salva"}</span>
              <span class="muted">{reachLine(reach[office.id] ?? "checking", office.pinned)}</span>
            </div>
            <button type="button" aria-label={`Entrar em ${office.host}`} disabled={busy} onClick={() => void run(() => bridge.offices.open(office.id))}>
              Entrar
            </button>
            <button type="button" aria-label={`Esquecer ${office.host}`} onClick={() => void forget(office)}>
              Esquecer
            </button>
            {/* Sem pino, nada prova que o endereço novo é o mesmo escritório: a sessão e o token iriam para qualquer um. */}
            {office.pinned && (
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
            )}
            {office.pinned && changing === office.id && (
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
    </main>
  );
}
