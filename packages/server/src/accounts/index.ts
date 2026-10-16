import type { Db } from "../db.js";
import { InviteStore } from "./invites.js";
import { SessionStore } from "./sessions.js";
import { TokenStore } from "./tokens.js";
import { UserStore } from "./users.js";

export interface AccountServices {
  users: UserStore;
  invites: InviteStore;
  sessions: SessionStore;
  tokens: TokenStore;
}

export function createAccountServices(db: Db, now: () => number): AccountServices {
  const users = new UserStore(db, now);
  return { users, invites: new InviteStore(db, users, now), sessions: new SessionStore(db, now), tokens: new TokenStore(db, now) };
}

/** Desativa a conta e derruba tudo o que ela abriu; conexões vivas caem na próxima varredura. */
export function disableUser(accounts: AccountServices, userId: number): void {
  accounts.users.disable(userId);
  accounts.sessions.deleteForUser(userId);
  accounts.tokens.revokeAllForUser(userId);
}
