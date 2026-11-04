import type { AppRoute, CurrentOffice, OfficeSummary } from "@workforces/protocol";
import { parseOfficeAddress, type Invite } from "./links.js";
import type { OfficeStore } from "./offices/store.js";

export interface ForwardTarget {
  url: string;
  session: string | null;
  /** A âncora do escritório (certificado confiável); null: vale a confiança do sistema. */
  anchor: string | null;
}

/** O que uma resposta do escritório mudou na sessão: `session` null = logout. */
export interface AuthChange {
  session: string | null;
  userName: string | null;
}

/** O escritório aberto agora. Só na memória: o que vale para o próximo início está no `OfficeStore`. */
interface OpenOffice {
  url: string;
  officeId: string | null;
  userName: string | null;
  session: string | null;
  bridgeToken: string | null;
  /** O pino do convite e a âncora conferida por ele (os dois nulos ou os dois preenchidos). */
  pin: string | null;
  anchor: string | null;
  sessionExpired: boolean;
}

/** Qual escritório está aberto e para onde a página vai; o processo principal consulta e atualiza. */
export class AppState {
  private open_: OpenOffice | null = null;

  constructor(private readonly store: OfficeStore) {}

  /** Primeira tela: o último escritório com sessão, ou a tela inicial (com o aviso do perfil ilegível, se houver). */
  startup(): AppRoute {
    const last = this.store.lastUsed();
    if (last && last.session !== null) {
      this.open_ = { url: last.url, officeId: last.id, userName: last.userName, session: last.session, bridgeToken: last.bridgeToken, pin: last.pin, anchor: last.anchor, sessionExpired: false };
      return { page: "office" };
    }
    const problem = this.store.problem;
    return problem === null ? { page: "launcher" } : { page: "launcher", notice: problem };
  }

  /** Um convite já lido e, se tinha pino, com a âncora conferida (`prepareInvite`): abre a criação da conta naquele escritório. */
  openInvite(invite: Invite, anchor: string | null): AppRoute {
    this.open_ = { url: invite.server, officeId: null, userName: null, session: null, bridgeToken: null, pin: invite.pin, anchor, sessionExpired: false };
    return { page: "invite", code: invite.code };
  }

  /** "Já tenho conta": o endereço vira um escritório pendente, e a pessoa entra pelo login. */
  add(address: string): AppRoute {
    const parsed = parseOfficeAddress(address);
    if ("error" in parsed) return { page: "launcher", notice: parsed.error };
    this.open_ = { url: parsed.url, officeId: null, userName: null, session: null, bridgeToken: null, pin: null, anchor: null, sessionExpired: false };
    return { page: "login" };
  }

  open(id: string): AppRoute {
    const entry = this.store.get(id);
    if (!entry) return { page: "launcher", notice: "esse escritório não está mais na lista" };
    this.open_ = { url: entry.url, officeId: entry.id, userName: entry.userName, session: entry.session, bridgeToken: entry.bridgeToken, pin: entry.pin, anchor: entry.anchor, sessionExpired: false };
    this.store.markUsed(id);
    return entry.session !== null ? { page: "office" } : { page: "login" };
  }

  forget(id: string): void {
    // Fecha antes: se a gravação falhar, o aberto não fica apontando para um escritório esquecido.
    if (this.open_?.officeId === id) this.open_ = null;
    this.store.forget(id);
  }

  list(): OfficeSummary[] {
    return this.store.list().map((entry) => ({
      id: entry.id,
      url: entry.url,
      host: new URL(entry.url).host,
      userName: entry.userName,
      loggedIn: entry.session !== null,
    }));
  }

  current(): CurrentOffice | null {
    const open = this.open_;
    if (!open) return null;
    return {
      id: open.officeId,
      url: open.url,
      host: new URL(open.url).host,
      userName: open.userName,
      loggedIn: open.session !== null,
      sessionExpired: open.sessionExpired,
    };
  }

  /** Para onde as requisições da página vão, e com qual sessão. */
  target(): ForwardTarget | null {
    return this.open_ ? { url: this.open_.url, session: this.open_.session, anchor: this.open_.anchor } : null;
  }

  /** O escritório aberto e já salvo, com a conta e o token da ponte; é por onde o app abre e lista os agentes. Sem nome de conta, null. */
  agentOffice(): { id: string; url: string; userName: string; session: string | null; bridgeToken: string | null; anchor: string | null } | null {
    const open = this.open_;
    if (!open || open.officeId === null || open.userName === null) return null;
    return { id: open.officeId, url: open.url, userName: open.userName, session: open.session, bridgeToken: open.bridgeToken, anchor: open.anchor };
  }

  /** Para o teste de rede de um escritório da lista: o endereço e a âncora que ele exige. */
  reachTarget(id: string): { url: string; anchor: string | null } | null {
    const entry = this.store.get(id);
    return entry ? { url: entry.url, anchor: entry.anchor } : null;
  }

  /** Guarda o token da ponte de um escritório, pelo id: o aberto pode ter mudado enquanto o token era criado. */
  saveBridgeToken(officeId: string, token: string): void {
    const open = this.open_;
    if (open?.officeId === officeId) open.bridgeToken = token;
    this.store.setBridgeToken(officeId, token);
  }

  /** Uma resposta do escritório trouxe ou apagou a sessão (login, cadastro, logout). */
  applyAuth(change: AuthChange): void {
    const open = this.open_;
    if (!open) return;
    if (change.session !== null) {
      const userName = change.userName ?? open.userName;
      if (userName === null) {
        // Sem nome não há como identificar a entrada: a sessão vale só até fechar o app.
        open.session = change.session;
        return;
      }
      // A sessão que o servidor acabou de dar fica na memória mesmo que a gravação falhe.
      open.session = change.session;
      open.sessionExpired = false;
      const saved = this.store.saveLogin(open.url, userName, change.session, { pin: open.pin, anchor: open.anchor });
      this.open_ = { url: saved.url, officeId: saved.id, userName: saved.userName, session: change.session, bridgeToken: saved.bridgeToken, pin: saved.pin, anchor: saved.anchor, sessionExpired: false };
      return;
    }
    open.session = null;
    if (open.officeId !== null) this.store.setSession(open.officeId, null);
  }

  /** O servidor recusou a sessão guardada (401): apaga e faz o login avisar. */
  unauthorized(): void {
    const open = this.open_;
    if (!open || open.session === null) return;
    open.session = null;
    open.sessionExpired = true;
    if (open.officeId !== null) this.store.setSession(open.officeId, null);
  }
}
