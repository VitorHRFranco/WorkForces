import type { AppRoute, HostAddressInfo, HostSettingsInput, HostStatus, WanStatus } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { navigate, routePath } from "../router";

const FIREWALL =
  "Ao ligar, o Windows pode perguntar se libera o Node.js (o programa que roda o escritório) na rede. Marque redes privadas e também públicas: o Windows trata o Hamachi e outras VPNs como rede pública.";
const FIREWALL_HELP = "Painel de Controle → Firewall do Windows Defender → Permitir um aplicativo → Node.js → marque Privada e Pública.";
/** O rádio ocupa só o tamanho dele, ao lado do texto (o estilo geral estica os campos). */
const RADIO = { width: "auto" };

/** O estado do escritório deste computador, como a tela inicial e a do anfitrião mostram. */
export function hostStateText(status: HostStatus): string {
  switch (status.state) {
    case "starting":
      return "ligando…";
    case "on":
      return `ligado · ${status.inviteOrigin ?? ""}`;
    case "stopping":
      return "desligando…";
    default:
      return "desligado";
  }
}

/** O endereço do convite mudou desde a última vez que o escritório ligou; a tela inicial e a do anfitrião mostram. */
export function AddressChangedNotice({ status }: { status: HostStatus }) {
  if (!status.addressChanged) return null;
  return (
    <p class="notice" role="status">
      {`o endereço deste computador mudou de ${status.addressChanged.from} para ${status.addressChanged.to}; quem já entrou precisa usar "Trocar endereço" no app`}
    </p>
  );
}

/** Ouve o estado do escritório deste computador; o que chega pelo aviso vale mais que a primeira leitura. */
export function useHostStatus(onFirst: (status: HostStatus) => void, onError: () => void): [HostStatus | null, (status: HostStatus) => void] {
  const [status, setStatus] = useState<HostStatus | null>(null);
  useEffect(() => {
    let pushed = false;
    const off = bridge.host.onStatus((next) => {
      pushed = true;
      setStatus(next);
    });
    bridge.host.status().then((first) => {
      if (!pushed) setStatus(first);
      onFirst(first);
    }, onError);
    return off;
  }, []);
  return [status, setStatus];
}

/** A sugestão: o Wi-Fi ou a Ethernet antes da VPN. */
const suggestion = (addresses: HostAddressInfo[]): HostAddressInfo | undefined => addresses.find((info) => info.kind === "lan") ?? addresses[0];

/** Com a WAN ligada: o que o roteador fez com a porta e, se não abriu, o passo a passo com os valores deste computador. */
function WanReport({ status, wan }: { status: HostStatus; wan: WanStatus }) {
  const port = status.settings?.port;
  return (
    <>
      {wan.mapping === "port-taken" && (
        <p class="notice" role="status">
          {`o roteador diz que a porta ${port} já está redirecionada para outro aparelho: escolha outra porta em Porta ou apague o redirecionamento antigo no roteador.`}
        </p>
      )}
      {wan.mapping === "mapped" ? (
        <p class="notice" role="status">{`porta ${port} aberta no roteador (UPnP)`}</p>
      ) : (
        // Sem IP local não há para onde redirecionar: o aviso de "Nenhuma rede encontrada" já diz o que fazer.
        wan.localIp !== null && (
          <>
            <p>o roteador não abriu a porta sozinho; veja como abrir à mão:</p>
            <ol>
              <li>{`Deixe o IP deste computador fixo na rede: no roteador, reserve o IP ${wan.localIp} para este computador (reserva de DHCP).`}</li>
              <li>{`Redirecione a porta ${port} (TCP) para ${wan.localIp}.`}</li>
              <li>Libere o Node.js no Firewall do Windows (redes privadas e públicas).</li>
            </ol>
          </>
        )
      )}
      {wan.notPublic && (
        <p class="notice" role="status">
          {`O IP que o roteador informa (${wan.externalIp}) não é público: o provedor usa CGNAT, ou há dois roteadores em sequência. Gente de fora não chega por ele. Peça um IP público ao provedor ou hospede em LAN com uma VPN como o Hamachi.`}
        </p>
      )}
      {status.usingLanFallback && (
        <p class="notice" role="status">
          {`Sem o endereço da internet, os convites levam o endereço da rede local (${status.inviteOrigin}). Digite o IP público ou um nome (DDNS) acima.`}
        </p>
      )}
    </>
  );
}

export function HostPage() {
  const [mode, setMode] = useState<HostSettingsInput["mode"]>("lan");
  const [port, setPort] = useState("4600");
  const [address, setAddress] = useState("");
  const [wanAddress, setWanAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useHostStatus(
    (first) => {
      // O formulário começa com as escolhas salvas; o endereço salvo que sumiu dá lugar à sugestão.
      if (first.settings) {
        setMode(first.settings.mode);
        setPort(String(first.settings.port));
        setWanAddress(first.settings.wanAddress ?? "");
      }
      const saved = first.addresses.find((info) => info.address === first.settings?.lanAddress);
      setAddress((saved ?? suggestion(first.addresses))?.address ?? "");
    },
    () => setError("não consegui ler o escritório deste computador; volte e tente de novo"),
  );

  const act = async (action: () => Promise<void>, failure: string) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  /** A rota da tela inicial traz o motivo da falha: ele aparece aqui mesmo. */
  const follow = (route: AppRoute) => {
    if (route.page === "launcher") setError(route.notice ?? null);
    else navigate(routePath(route));
  };

  const save = async (): Promise<boolean> => {
    // O endereço da internet só vale na WAN; na LAN, o salvo fica como está. Campo vazio é "sem endereço".
    const typed = wanAddress.trim();
    const wan = mode === "wan" ? (typed === "" ? null : typed) : (status?.settings?.wanAddress ?? null);
    // Na WAN o seletor de rede fica escondido: null deixa o app usar a sugestão do momento, e uma rede que sumiu com a tela
    // aberta não vira "escolha um da lista" num campo que a pessoa nem vê.
    const lan = mode === "wan" || address === "" ? null : address;
    const input: HostSettingsInput = { mode, port: Number(port), lanAddress: lan, wanAddress: wan };
    const result = await bridge.host.configure(input);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setStatus(result.status);
    return true;
  };

  const enter = () => void act(async () => follow(await bridge.host.enter()), "não consegui ligar o escritório. Tente de novo.");
  const stop = () => void act(async () => setStatus(await bridge.host.stop()), "não consegui desligar o escritório. Tente de novo.");

  const submit = (event: Event) => {
    event.preventDefault();
    // Sem escritório, o botão é "Criar e entrar": grava as escolhas e já liga.
    const creating = !status?.created;
    void act(
      async () => {
        if ((await save()) && creating) follow(await bridge.host.enter());
      },
      creating ? "não consegui criar o escritório. Tente de novo." : "não consegui salvar. Tente de novo.",
    );
  };

  const errors = [...new Set([error, status?.error ?? null])].filter((text): text is string => text !== null);

  return (
    <main class="card launcher">
      <h1>Escritório neste computador</h1>
      {status?.created && <p class="muted">{hostStateText(status)}</p>}
      {errors.map((text) => (
        <p key={text} class="error" role="alert">
          {text}
        </p>
      ))}
      {status && <AddressChangedNotice status={status} />}
      {status && (
        <form onSubmit={submit}>
          <div role="radiogroup" aria-label="Modo">
            <label>
              <span>
                <input type="radio" name="mode" style={RADIO} checked={mode === "lan"} onChange={() => setMode("lan")} />
                {" Hospedar LAN (rede local ou VPN como o Hamachi)"}
              </span>
            </label>
            <label>
              <span>
                <input type="radio" name="mode" style={RADIO} checked={mode === "wan"} onChange={() => setMode("wan")} />
                {" Hospedar WAN (internet)"}
              </span>
            </label>
          </div>
          <label>
            Porta
            <input type="number" min={1024} max={65535} value={port} onInput={(e) => setPort(e.currentTarget.value)} required />
          </label>
          {mode === "wan" ? (
            <>
              <label>
                Endereço da internet (opcional): IP público ou nome (DDNS)
                <input value={wanAddress} onInput={(e) => setWanAddress(e.currentTarget.value)} autocapitalize="none" spellcheck={false} maxLength={253} />
              </label>
              {status.state === "on" && status.wan && <WanReport status={status} wan={status.wan} />}
            </>
          ) : (
            <label>
              Endereço no convite
              <select value={address} onChange={(e) => setAddress(e.currentTarget.value)}>
                {status.addresses.map((info) => (
                  <option key={info.address} value={info.address}>
                    {info.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {status.addresses.length === 0 && <p class="muted">Nenhuma rede encontrada: conecte este computador ao Wi-Fi, ao cabo ou à VPN para outras pessoas entrarem.</p>}
          <p class="muted">{FIREWALL}</p>
          <details>
            <summary>Negou sem querer?</summary>
            <p class="muted">{FIREWALL_HELP}</p>
          </details>
          {status.created ? (
            <>
              <button type="submit" disabled={busy}>
                Salvar
              </button>
              <button type="button" disabled={busy || status.state === "starting" || status.state === "stopping"} onClick={enter}>
                {status.state === "on" ? "Entrar" : "Ligar e entrar"}
              </button>
              {status.state === "on" && (
                <button type="button" disabled={busy} onClick={stop}>
                  Desligar
                </button>
              )}
            </>
          ) : (
            <button type="submit" disabled={busy}>
              Criar e entrar
            </button>
          )}
        </form>
      )}
      <button type="button" onClick={() => navigate("/")}>
        Voltar
      </button>
    </main>
  );
}
