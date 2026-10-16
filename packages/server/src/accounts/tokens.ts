import type { TokenCreated, TokenInfo } from "@workforces/protocol";
import type { Db } from "../db.js";
import { randomSecret, sha256 } from "./secrets.js";
import type { User } from "./users.js";

export const TOKEN_PREFIX = "wf_";

interface TokenRow {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

interface VerifyRow {
  token_id: number;
  id: number;
  name: string;
  is_admin: number;
}

const ACTIVE = "t.revoked_at is null and u.disabled_at is null";

export class TokenStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  create(userId: number, name: string): TokenCreated {
    const token = TOKEN_PREFIX + randomSecret(32);
    const info = this.db
      .prepare("insert into bridge_tokens (user_id, name, token_hash, created_at) values (?, ?, ?, ?)")
      .run(userId, name, sha256(token), this.now());
    return { id: Number(info.lastInsertRowid), name, token };
  }

  list(userId: number): TokenInfo[] {
    const rows = this.db
      .prepare("select id, name, created_at, last_used_at from bridge_tokens where user_id = ? and revoked_at is null order by id")
      .all(userId) as TokenRow[];
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
  }

  revoke(userId: number, id: number): boolean {
    const info = this.db
      .prepare("update bridge_tokens set revoked_at = ? where id = ? and user_id = ? and revoked_at is null")
      .run(this.now(), id, userId);
    return info.changes > 0;
  }

  revokeAllForUser(userId: number): void {
    this.db.prepare("update bridge_tokens set revoked_at = ? where user_id = ? and revoked_at is null").run(this.now(), userId);
  }

  verify(token: string | null): { tokenId: number; user: User } | null {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const row = this.db
      .prepare(
        `select t.id as token_id, u.id, u.name, u.is_admin from bridge_tokens t
         join users u on u.id = t.user_id
         where t.token_hash = ? and ${ACTIVE}`,
      )
      .get(sha256(token)) as VerifyRow | undefined;
    return row ? { tokenId: row.token_id, user: { id: row.id, name: row.name, isAdmin: row.is_admin === 1 } } : null;
  }

  touch(tokenId: number): void {
    this.db.prepare("update bridge_tokens set last_used_at = ? where id = ?").run(this.now(), tokenId);
  }

  isValid(tokenId: number): boolean {
    return (
      this.db.prepare(`select 1 from bridge_tokens t join users u on u.id = t.user_id where t.id = ? and ${ACTIVE}`).get(tokenId) !==
      undefined
    );
  }
}
