import type { Db } from "../db.js";
import { randomSecret, sha256 } from "./secrets.js";
import type { User } from "./users.js";

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 14 * DAY;
const RENEW_BELOW_MS = 7 * DAY;

interface SessionRow {
  expires_at: number;
  id: number;
  name: string;
  is_admin: number;
}

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  /** Devolve o id da sessão; só o hash vai para o banco. */
  create(userId: number): string {
    const id = randomSecret(32);
    this.db.prepare("delete from sessions where expires_at <= ?").run(this.now());
    this.db.prepare("insert into sessions (id_hash, user_id, expires_at) values (?, ?, ?)").run(sha256(id), userId, this.now() + SESSION_TTL_MS);
    return id;
  }

  lookup(sessionId: string | null): User | null {
    if (!sessionId) return null;
    const hash = sha256(sessionId);
    const row = this.db
      .prepare(
        `select s.expires_at, u.id, u.name, u.is_admin from sessions s
         join users u on u.id = s.user_id
         where s.id_hash = ? and u.disabled_at is null`,
      )
      .get(hash) as SessionRow | undefined;
    if (!row || row.expires_at <= this.now()) return null;
    if (row.expires_at - this.now() < RENEW_BELOW_MS) {
      this.db.prepare("update sessions set expires_at = ? where id_hash = ?").run(this.now() + SESSION_TTL_MS, hash);
    }
    return { id: row.id, name: row.name, isAdmin: row.is_admin === 1 };
  }

  delete(sessionId: string): void {
    this.db.prepare("delete from sessions where id_hash = ?").run(sha256(sessionId));
  }

  deleteForUser(userId: number): void {
    this.db.prepare("delete from sessions where user_id = ?").run(userId);
  }
}
