import type { HostAddressInfo, HostConfigResult, HostSettingsInput, HostState, HostStatus, WanStatus } from "@workforces/protocol";
import { suggestAddress } from "./addresses.js";
import type { EmbeddedServer } from "./server-process.js";
import type { HostSettings, HostSettingsStore } from "./settings.js";
import { classifyIp, isWanAddress, type MapResult, type PortMapper } from "./wan.js";

export const PORT_RANGE_ERROR = "a porta precisa ser um número de 1024 a 65535";
export const WAN_ADDRESS_ERROR = "use um IP (como 203.0.113.7) ou um nome (como escritorio.ddns.net), sem https:// e sem porta";
const NOT_CREATED = "crie o escritório primeiro";
const UNKNOWN_ADDRESS = "esse endereço não é de nenhuma rede deste computador; escolha um da lista";
const NO_NODE = "para hospedar, instale o Node.js 22.12 ou mais novo (o mesmo que os agentes usam) e tente de novo";
const NO_NETWORK = "este computador não está em nenhuma rede: só ele alcança o escritório";
const STOPPED_ALONE = "o escritório parou sozinho; ligue de novo";
const START_FAILED = "não consegui ligar o escritório; tente de novo e, se repetir, feche e abra o WorkForces";
const START_TIMEOUT = "o escritório demorou demais para ligar; tente de novo";
const SAVE_FAILED = "não consegui gravar as escolhas do escritório; feche outros programas que usem a pasta do WorkForces e tente de novo";
const portInUse = (port: number): string => `a porta ${port} já está em uso por outro programa; escolha outra em "Porta"`;
const LOOPBACK = "127.0.0.1";

export type HostTurnOn = { ok: true; pin: string; anchor: string; adminInvite: string | null } | { ok: false; error: string };

export interface HostDeps {
  settings: HostSettingsStore;
  server: Pick<EmbeddedServer, "start" | "stop" | "onExit">;
  /** Na WAN, abre a porta no roteador (UPnP) antes de o servidor subir. */
  portMapper: PortMapper;
  findNode(): Promise<string | null>;
  addresses(): HostAddressInfo[];
  /** O `embedded.js` do servidor. */
  entry: string;
  /** Onde o escritório guarda o banco e o certificado. */
  dataDir: string;
  emit(status: HostStatus): void;
  log(m: string): void;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** O host que vai no convite; `loopback` é o próprio computador (sem rede) e `lanFallback`, a LAN no lugar da internet. */
type InviteHost = { host: string; loopback: boolean; lanFallback: boolean };

/** O escritório deste computador: as escolhas, o servidor embutido e o estado que a tela mostra. */
export class Host {
  private state: HostState = "off";
  private error: string | null = null;
  private inviteOrigin: string | null = null;
  private addressChanged: { from: string; to: string } | null = null;
  /** Na WAN ligada: o que o roteador respondeu e se os convites caíram na LAN. */
  private wan: WanStatus | null = null;
  private usingLanFallback = false;
  /** O `portMapper` foi chamado para abrir e ainda não foi fechado. */
  private portOpen = false;
  /** O que o servidor no ar respondeu no ready. */
  private live: { pin: string; anchor: string; adminInvite: string | null } | null = null;
  /** Ligar, desligar e reiniciar rodam um de cada vez, na ordem dos pedidos. */
  private queue: Promise<unknown> = Promise.resolve();
  private turningOn: Promise<HostTurnOn> | null = null;
  private turningOff: Promise<void> | null = null;

  constructor(private readonly deps: HostDeps) {
    deps.server.onExit(() => {
      this.clearLive();
      this.change("off", STOPPED_ALONE);
      // Sem servidor, a porta no roteador não leva a nada: desfaz na vez dela, antes de um novo ligar.
      void this.serial(() => this.closeMapping());
    });
  }

  status(): HostStatus {
    const saved = this.deps.settings.get();
    return {
      created: saved !== null,
      state: this.state,
      settings: saved ? { mode: saved.mode, port: saved.port, lanAddress: saved.lanAddress, wanAddress: saved.wanAddress } : null,
      inviteOrigin: this.inviteOrigin,
      addresses: this.deps.addresses(),
      addressChanged: this.addressChanged,
      usingLanFallback: this.usingLanFallback,
      wan: this.wan,
      error: this.error,
    };
  }

  /** Grava as escolhas; com o escritório no ar, trocar o modo, a porta ou o endereço o reinicia. */
  async configure(input: HostSettingsInput): Promise<HostConfigResult> {
    if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) return { ok: false, error: PORT_RANGE_ERROR };
    if (input.lanAddress !== null && !this.deps.addresses().some((info) => info.address === input.lanAddress)) return { ok: false, error: UNKNOWN_ADDRESS };
    if (input.wanAddress !== null && !isWanAddress(input.wanAddress)) return { ok: false, error: WAN_ADDRESS_ERROR };
    const previous = this.deps.settings.get();
    try {
      this.deps.settings.save({
        mode: input.mode,
        port: input.port,
        lanAddress: input.lanAddress,
        wanAddress: input.wanAddress,
        pin: previous?.pin ?? null,
        lastInviteHost: previous?.lastInviteHost ?? null,
      });
    } catch (error) {
      this.deps.log(`não consegui gravar o host.json (${errorText(error)})`);
      return { ok: false, error: SAVE_FAILED };
    }
    // Desligado, o erro da última tentativa (ex.: porta ocupada) já foi respondido com a escolha nova.
    if (this.state === "off") this.error = null;
    this.deps.emit(this.status());
    const changed =
      previous !== null &&
      (previous.mode !== input.mode || previous.port !== input.port || previous.lanAddress !== input.lanAddress || previous.wanAddress !== input.wanAddress);
    if (changed) {
      await this.serial(async () => {
        if (this.state !== "on") return;
        await this.stopNow();
        await this.startNow();
      });
    }
    return { ok: true, status: this.status() };
  }

  /** Liga o escritório; já ligado (ou ligando), devolve o mesmo resultado sem subir outro servidor. */
  turnOn(): Promise<HostTurnOn> {
    if (this.turningOn) return this.turningOn;
    const pending: Promise<HostTurnOn> = this.serial(() => this.startNow()).finally(() => {
      if (this.turningOn === pending) this.turningOn = null;
    });
    this.turningOn = pending;
    return pending;
  }

  turnOff(): Promise<void> {
    if (this.turningOff) return this.turningOff;
    const pending: Promise<void> = this.serial(() => this.stopNow()).finally(() => {
      if (this.turningOff === pending) this.turningOff = null;
    });
    this.turningOff = pending;
    return pending;
  }

  /** O pino do certificado do escritório deste computador: é por ele que a entrada salva é reconhecida. */
  hostedPin(): string | null {
    return this.live?.pin ?? this.deps.settings.get()?.pin ?? null;
  }

  /** O endereço pelo qual este computador entra no próprio escritório (o servidor escuta em todas as redes). */
  localUrl(): string | null {
    const saved = this.deps.settings.get();
    return saved ? `https://${LOOPBACK}:${saved.port}` : null;
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  private change(state: HostState, error: string | null): void {
    this.state = state;
    this.error = error;
    this.deps.emit(this.status());
  }

  /** O que só vale com o servidor no ar. */
  private clearLive(): void {
    this.live = null;
    this.inviteOrigin = null;
    this.wan = null;
    this.usingLanFallback = false;
  }

  private async failed(error: string): Promise<HostTurnOn> {
    // Sem servidor, a porta aberta no roteador não leva a nada.
    await this.closeMapping();
    this.clearLive();
    this.change("off", error);
    return { ok: false, error };
  }

  /** Desfaz a porta no roteador, se este escritório pediu uma; nunca falha (o roteador pode nem responder). */
  private async closeMapping(): Promise<void> {
    if (!this.portOpen) return;
    this.portOpen = false;
    try {
      await this.deps.portMapper.close();
    } catch (error) {
      this.deps.log(`não consegui desfazer a porta no roteador (${errorText(error)})`);
    }
  }

  /** O endereço da rede local: o escolhido ou, se ele sumiu, a sugestão; sem rede nenhuma, o próprio computador. */
  private lanHost(settings: HostSettings): InviteHost {
    const list = this.deps.addresses();
    const chosen = list.find((info) => info.address === settings.lanAddress) ?? suggestAddress(list);
    return chosen ? { host: chosen.address, loopback: false, lanFallback: false } : { host: LOOPBACK, loopback: true, lanFallback: false };
  }

  /** O endereço do convite. Na WAN: o digitado, depois o IP público do roteador e, sem nenhum dos dois, o da rede local. */
  private inviteHost(settings: HostSettings, mapped: MapResult | null): InviteHost {
    if (settings.mode === "lan") return this.lanHost(settings);
    if (settings.wanAddress !== null) return { host: settings.wanAddress, loopback: false, lanFallback: false };
    const externalIp = mapped?.ok ? mapped.externalIp : null;
    if (externalIp !== null && classifyIp(externalIp) === "public") return { host: externalIp, loopback: false, lanFallback: false };
    return { ...this.lanHost(settings), lanFallback: true };
  }

  /** O que a tela mostra da WAN: a porta no roteador, o IP que ele informa e o IP local para o passo a passo. */
  private wanStatus(mapped: MapResult): WanStatus {
    const externalIp = mapped.ok ? mapped.externalIp : null;
    return {
      mapping: mapped.ok ? "mapped" : mapped.reason,
      externalIp,
      notPublic: externalIp !== null && classifyIp(externalIp) !== "public",
      // O passo a passo vale para o Wi-Fi ou a Ethernet (a rede do roteador), não para a VPN.
      localIp: suggestAddress(this.deps.addresses())?.address ?? null,
    };
  }

  private async startNow(): Promise<HostTurnOn> {
    if (this.state === "on" && this.live) return { ok: true, ...this.live };
    const settings = this.deps.settings.get();
    if (!settings) return { ok: false, error: NOT_CREATED };
    this.addressChanged = null;
    this.change("starting", null);
    try {
      const node = await this.deps.findNode();
      if (!node) return await this.failed(NO_NODE);
      // Na WAN, a porta abre no roteador antes de o servidor subir: o convite já sai com o IP público.
      let mapped: MapResult | null = null;
      if (settings.mode === "wan") {
        this.portOpen = true;
        mapped = await this.deps.portMapper.open(settings.port);
      }
      const invite = this.inviteHost(settings, mapped);
      const publicUrl = `https://${invite.host}:${settings.port}`;
      const started = await this.deps.server.start({ node, entry: this.deps.entry, host: "0.0.0.0", port: settings.port, publicUrl, dataDir: this.deps.dataDir });
      if (!started.ok) return await this.failed(started.error === "port-in-use" ? portInUse(settings.port) : started.error === "timeout" ? START_TIMEOUT : START_FAILED);
      const { pin, anchor, adminInvite } = started;
      const before = settings.lastInviteHost;
      // Sem rede, o 127.0.0.1 não é o endereço de ninguém: o último endereço de verdade continua valendo para comparar.
      const lastInviteHost = invite.loopback ? before : invite.host;
      // Grava só depois do ready: o pino existe quando o certificado existe, e o endereço vale porque o servidor subiu com ele.
      try {
        this.deps.settings.save({ ...(this.deps.settings.get() ?? settings), pin, lastInviteHost });
      } catch (error) {
        this.deps.log(`não consegui gravar o pino no host.json (${errorText(error)})`);
      }
      this.addressChanged = !invite.loopback && before !== null && before !== invite.host ? { from: before, to: invite.host } : null;
      this.live = { pin, anchor, adminInvite };
      this.inviteOrigin = publicUrl;
      this.wan = mapped ? this.wanStatus(mapped) : null;
      this.usingLanFallback = invite.lanFallback;
      this.change("on", invite.loopback ? NO_NETWORK : null);
      return { ok: true, pin, anchor, adminInvite };
    } catch (error) {
      this.deps.log(`não consegui ligar o escritório (${errorText(error)})`);
      return await this.failed(START_FAILED);
    }
  }

  private async stopNow(): Promise<void> {
    if (this.state === "off") return;
    this.change("stopping", null);
    try {
      await this.deps.server.stop();
    } finally {
      // A porta no roteador fecha depois de o servidor parar: a ordem inversa de ligar.
      await this.closeMapping();
      this.clearLive();
      this.change("off", null);
    }
  }
}
