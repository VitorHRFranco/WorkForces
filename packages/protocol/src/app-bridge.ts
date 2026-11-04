import type { AgentState } from "./bridge.js";
import type { FrameBody } from "./frame.js";
import type { HostConfigResult, HostSettingsInput, HostStatus } from "./host.js";

/** Um escritório salvo no app. */
export interface OfficeSummary {
  id: string;
  /** Origem do servidor (https://…, ou http:// só em localhost). */
  url: string;
  host: string;
  userName: string | null;
  loggedIn: boolean;
  /** É o escritório deste computador (o pino é o dele): a tela inicial o mostra em "Neste computador". */
  hosted: boolean;
}

/** O escritório aberto agora; `id` é null até a conta ser criada ou o login ser feito. */
export interface CurrentOffice {
  id: string | null;
  url: string;
  host: string;
  userName: string | null;
  loggedIn: boolean;
  /** O servidor recusou a sessão guardada: a tela de login avisa. */
  sessionExpired: boolean;
}

/** Para onde a página vai. */
export type AppRoute = { page: "launcher"; notice?: string } | { page: "login" } | { page: "invite"; code: string } | { page: "office" };

/** Por que o app não abriu o agente (a página mostra o texto em português). */
export type SpawnError =
  | "no-office"
  | "office-down"
  | "unknown-alias"
  | "folder-missing"
  | "rate-limited"
  | "too-many-agents"
  | "no-terminal"
  | "no-node"
  | "spawn-failed"
  | "no-answer"
  | "unsupported";

export type SpawnOutcome = { ok: true } | { ok: false; error: SpawnError };

/** Uma pasta liberada para "Chamar agente" (o `path` fica no computador; a página só vê o que o app mostra). */
export interface FolderInfo {
  alias: string;
  path: string;
  exists: boolean;
}

export type FolderChange = { ok: true; folders: FolderInfo[] } | { ok: false; error: string };

/** O resultado de trocar o endereço de um escritório salvo. */
export type AddressChange = { ok: true } | { ok: false; error: string };

export type SocketEvent = { type: "open" } | { type: "message"; data: string } | { type: "close"; code: number };

/** O `window.workforces` do preload: tudo o que a página pede ao processo principal. */
export interface AppBridge {
  startup(): Promise<AppRoute>;
  onRoute(listener: (route: AppRoute) => void): () => void;
  offices: {
    list(): Promise<OfficeSummary[]>;
    reachable(id: string): Promise<boolean>;
    open(id: string): Promise<AppRoute>;
    add(address: string): Promise<AppRoute>;
    forget(id: string): Promise<void>;
    changeAddress(id: string, address: string): Promise<AddressChange>;
    current(): Promise<CurrentOffice | null>;
  };
  invites: { open(link: string): Promise<AppRoute> };
  /** O escritório deste computador. */
  host: {
    status(): Promise<HostStatus>;
    configure(input: HostSettingsInput): Promise<HostConfigResult>;
    /** Liga, se preciso, e abre o escritório como o anfitrião. */
    enter(): Promise<AppRoute>;
    stop(): Promise<HostStatus>;
    onStatus(listener: (status: HostStatus) => void): () => void;
  };
  socket: {
    open(id: number): void;
    send(id: number, text: string): void;
    close(id: number, code: number): void;
    onEvent(listener: (id: number, event: SocketEvent) => void): () => void;
  };
  folders: {
    list(): Promise<FolderInfo[]>;
    /** Abre o seletor de pasta do sistema e libera a escolhida com o apelido; null = cancelou. */
    pickAndAdd(alias: string): Promise<FolderChange | null>;
    remove(alias: string): Promise<FolderInfo[]>;
  };
  agents: {
    spawn(alias: string): Promise<SpawnOutcome>;
    list(): Promise<LocalAgentInfo[]>;
    watch(agentId: string): void;
    unwatch(agentId: string): void;
    input(agentId: string, data: string): void;
    onEvent(listener: (event: LocalAgentEvent) => void): () => void;
  };
}

/** Um agente deste computador, como o app o enxerga pelo canal local. */
export interface LocalAgentInfo {
  agentId: string;
  label: string;
  office: string;
  state: AgentState;
  cols: number;
  rows: number;
}

export type LocalAgentEvent =
  | { type: "changed" }
  | { type: "frame"; agentId: string; frame: FrameBody }
  | { type: "status"; agentId: string; state: AgentState };
