import type { Db } from "../db.js";
import { hashPassword } from "./passwords.js";
import { randomSecret, sha256 } from "./secrets.js";
import type { User, UserStore } from "./users.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type AcceptResult = { ok: true; user: User } | { ok: false; reason: "invalid" | "name-taken" };

interface InviteRow {
  is_admin_invite: number;
}

export class InviteStore {
  constructor(
    private readonly db: Db,
    private readonly users: UserStore,
    private readonly now: () => number,
  ) {}

  create(options: { createdBy: number | null; isAdmin: boolean; ttlMs: number }): { code: string; expiresAt: number } {
    const code = randomSecret(24);
    const expiresAt = this.now() + options.ttlMs;
    this.db
      .prepare("insert into invites (code_hash, created_by, is_admin_invite, expires_at) values (?, ?, ?, ?)")
      .run(sha256(code), options.createdBy, options.isAdmin ? 1 : 0, expiresAt);
    return { code, expiresAt };
  }

  isValid(code: string): boolean {
    return this.find(code) !== null;
  }

  async accept(code: string, name: string, password: string): Promise<AcceptResult> {
    if (!this.find(code)) return { ok: false, reason: "invalid" };
    const passwordHash = await hashPassword(password);
    // Síncrono e atômico: dois aceites do mesmo convite não criam duas contas.
    return this.db.transaction((): AcceptResult => {
      const invite = this.find(code);
      if (!invite) return { ok: false, reason: "invalid" };
      if (this.users.nameTaken(name)) return { ok: false, reason: "name-taken" };
      const user = this.users.insert(name, passwordHash, invite.is_admin_invite === 1);
      this.db.prepare("update invites set used_at = ? where code_hash = ?").run(this.now(), sha256(code));
      return { ok: true, user };
    })();
  }

  private find(code: string): InviteRow | null {
    const row = this.db
      .prepare("select is_admin_invite from invites where code_hash = ? and used_at is null and expires_at > ?")
      .get(sha256(code), this.now()) as InviteRow | undefined;
    return row ?? null;
  }
}
