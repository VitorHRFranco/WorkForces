import type { HostAddressInfo, HostConfigResult, HostSettingsInput, HostState, HostStatus } from "@workforces/protocol";
import { suggestAddress } from "./addresses.js";
import type { EmbeddedServer } from "./server-process.js";
import type { HostSettings, HostSettingsStore } from "./settings.js";

export const PORT_RANGE_ERROR = "a porta precisa ser um número de 1024 a 65535";
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

/** O escritório deste computador: as escolhas, o servidor embutido e o estado que a tela mostra. */
export class Host {
  private state: HostState = "off";
  private error: string | null = null;
  private inviteOrigin: string | null = null;
  private addressChanged: { from: string; to: string } | null = null;
  /** O que o servidor no ar respondeu no ready. */
  private live: { pin: string; anchor: string; adminInvite: string | null } | null = null;
  /** Ligar, desligar e reiniciar rodam um de cada vez, na ordem dos pedidos. */
  private queue: Promise<unknown> = Promise.resolve();
  private turningOn: Promise<HostTurnOn> | null = null;
  private turningOff: Promise<void> | null = null;

  constructor(private readonly deps: HostDeps) {
    deps.server.onExit(() => {
      this.live = null;
      this.inviteOrigin = null;
      this.change("off", STOPPED_ALONE);
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
      usingLanFallback: false,
      wan: null,
      error: this.error,
    };
  }

  /** Grava as escolhas; com o escritório no ar, trocar o modo, a porta ou o endereço o reinicia. */
  async configure(input: HostSettingsInput): Promise<HostConfigResult> {
    if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) return { ok: false, error: PORT_RANGE_ERROR };
    if (input.lanAddress !== null && !this.deps.addresses().some((info) => info.address === input.lanAddress)) return { ok: false, error: UNKNOWN_ADDRESS };
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

  private failed(error: string): HostTurnOn {
    this.live = null;
    this.inviteOrigin = null;
    this.change("off", error);
    return { ok: false, error };
  }

  /** O endereço do convite: o escolhido ou, se ele sumiu, a sugestão; sem rede nenhuma, o próprio computador. */
  private inviteHost(settings: HostSettings): { host: string; loopback: boolean } {
    // Por enquanto os dois modos levam o endereço da rede local no convite.
    const list = this.deps.addresses();
    const chosen = list.find((info) => info.address === settings.lanAddress) ?? suggestAddress(list);
    return chosen ? { host: chosen.address, loopback: false } : { host: LOOPBACK, loopback: true };
  }

  private async startNow(): Promise<HostTurnOn> {
    if (this.state === "on" && this.live) return { ok: true, ...this.live };
    const settings = this.deps.settings.get();
    if (!settings) return { ok: false, error: NOT_CREATED };
    this.addressChanged = null;
    this.change("starting", null);
    try {
      const node = await this.deps.findNode();
      if (!node) return this.failed(NO_NODE);
      const invite = this.inviteHost(settings);
      const publicUrl = `https://${invite.host}:${settings.port}`;
      const started = await this.deps.server.start({ node, entry: this.deps.entry, host: "0.0.0.0", port: settings.port, publicUrl, dataDir: this.deps.dataDir });
      if (!started.ok) return this.failed(started.error === "port-in-use" ? portInUse(settings.port) : started.error === "timeout" ? START_TIMEOUT : START_FAILED);
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
      this.change("on", invite.loopback ? NO_NETWORK : null);
      return { ok: true, pin, anchor, adminInvite };
    } catch (error) {
      this.deps.log(`não consegui ligar o escritório (${errorText(error)})`);
      return this.failed(START_FAILED);
    }
  }

  private async stopNow(): Promise<void> {
    if (this.state === "off") return;
    this.change("stopping", null);
    try {
      await this.deps.server.stop();
    } finally {
      this.live = null;
      this.inviteOrigin = null;
      this.change("off", null);
    }
  }
}
