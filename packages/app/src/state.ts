import type { AppRoute, CurrentOffice, OfficeSummary } from "@workforces/protocol";
import { parseInviteLink, parseOfficeAddress } from "./links.js";
import type { OfficeStore } from "./offices/store.js";

export interface ForwardTarget {
  url: string;
  session: string | null;
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
  sessionExpired: boolean;
}

/** Qual escritório está aberto e para onde a página vai; o processo principal consulta e atualiza. */
export class AppState {
  private open_: OpenOffice | null = null;

  constructor(private readonly store: OfficeStore) {}

  /** Primeira tela: o convite da linha de comando, o último escritório com sessão, ou a tela inicial. */
  startup(link: string | null): AppRoute {
    if (link !== null) return this.openLink(link);
    const last = this.store.lastUsed();
    if (last && last.session !== null) {
      this.open_ = { url: last.url, officeId: last.id, userName: last.userName, session: last.session, sessionExpired: false };
      return { page: "office" };
    }
    return { page: "launcher" };
  }

  openLink(link: string): AppRoute {
    const parsed = parseInviteLink(link);
    if ("error" in parsed) return { page: "launcher", notice: parsed.error };
    this.open_ = { url: parsed.server, officeId: null, userName: null, session: null, sessionExpired: false };
    return { page: "invite", code: parsed.code };
  }

  /** "Já tenho conta": o endereço vira um escritório pendente, e a pessoa entra pelo login. */
  add(address: string): AppRoute {
    const parsed = parseOfficeAddress(address);
    if ("error" in parsed) return { page: "launcher", notice: parsed.error };
    this.open_ = { url: parsed.url, officeId: null, userName: null, session: null, sessionExpired: false };
    return { page: "login" };
  }

  open(id: string): AppRoute {
    const entry = this.store.get(id);
    if (!entry) return { page: "launcher", notice: "esse escritório não está mais na lista" };
    this.open_ = { url: entry.url, officeId: entry.id, userName: entry.userName, session: entry.session, sessionExpired: false };
    this.store.markUsed(id);
    return entry.session !== null ? { page: "office" } : { page: "login" };
  }

  forget(id: string): void {
    this.store.forget(id);
    if (this.open_?.officeId === id) this.open_ = null;
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
    return this.open_ ? { url: this.open_.url, session: this.open_.session } : null;
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
      const saved = this.store.saveLogin(open.url, userName, change.session);
      this.open_ = { url: saved.url, officeId: saved.id, userName: saved.userName, session: change.session, sessionExpired: false };
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
