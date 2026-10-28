/** Um escritório salvo no app. */
export interface OfficeSummary {
  id: string;
  /** Origem do servidor (https://…, ou http:// só em localhost). */
  url: string;
  host: string;
  userName: string | null;
  loggedIn: boolean;
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
    current(): Promise<CurrentOffice | null>;
  };
  invites: { open(link: string): Promise<AppRoute> };
  socket: {
    open(id: number): void;
    send(id: number, text: string): void;
    close(id: number, code: number): void;
    onEvent(listener: (id: number, event: SocketEvent) => void): () => void;
  };
}
