import type { Db } from "../db.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { randomSecret } from "./secrets.js";

export interface User {
  id: number;
  name: string;
  isAdmin: boolean;
}

interface UserRow {
  id: number;
  name: string;
  is_admin: number;
  password_hash: string;
  disabled_at: number | null;
}

/** Chave única do nome: NFKC + dobra de caixa (Straße = STRASSE, Ａｎａ = ana, ΟΔΟΣ = οδοσ, Lıvia = Livia). */
export function nameKeyOf(name: string): string {
  return name.normalize("NFKC").toLowerCase().toUpperCase().toLowerCase().normalize("NFKC");
}

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, isAdmin: row.is_admin === 1 });

export class UserStore {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  count(): number {
    return (this.db.prepare("select count(*) as n from users").get() as { n: number }).n;
  }

  byId(id: number): User | null {
    const row = this.db.prepare("select * from users where id = ? and disabled_at is null").get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  byNameIncludingDisabled(name: string): (User & { disabled: boolean }) | null {
    const row = this.db.prepare("select * from users where name_key = ?").get(nameKeyOf(name)) as UserRow | undefined;
    return row ? { ...toUser(row), disabled: row.disabled_at !== null } : null;
  }

  nameTaken(name: string): boolean {
    return this.db.prepare("select 1 from users where name_key = ?").get(nameKeyOf(name)) !== undefined;
  }

  /** Use dentro de uma transação que já conferiu `nameTaken`. */
  insert(name: string, passwordHash: string, isAdmin: boolean): User {
    const normalized = name.normalize("NFC");
    const info = this.db
      .prepare("insert into users (name, name_key, password_hash, is_admin, created_at) values (?, ?, ?, ?, ?)")
      .run(normalized, nameKeyOf(normalized), passwordHash, isAdmin ? 1 : 0, this.now());
    return { id: Number(info.lastInsertRowid), name: normalized, isAdmin };
  }

  async authenticate(name: string, password: string): Promise<User | null> {
    const row = this.db.prepare("select * from users where name_key = ? and disabled_at is null").get(nameKeyOf(name)) as
      | UserRow
      | undefined;
    if (!row) {
      // Mesmo custo de uma senha errada: não revela se o nome existe.
      this.dummyHash ??= hashPassword(randomSecret());
      await verifyPassword(password, await this.dummyHash);
      return null;
    }
    return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
  }

  disable(id: number): void {
    this.db.prepare("update users set disabled_at = ? where id = ? and disabled_at is null").run(this.now(), id);
  }

  isActive(id: number): boolean {
    return this.byId(id) !== null;
  }
}
