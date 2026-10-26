import type { Db } from "../db.js";
import type { Person } from "../realtime/world.js";

export class DeskStore {
  constructor(private readonly db: Db) {}

  /**
   * Mesa da pessoa. Na primeira vez (ou se a mesa dela saiu do mapa), recebe a primeira livre na ordem do
   * mapa; sem mesa livre, fica sem mesa (null). `changed` diz se a mesa gravada mudou.
   */
  ensure(userId: number, deskIds: readonly string[]): { deskId: string | null; changed: boolean } {
    return this.db.transaction(() => {
      const row = this.db.prepare("select desk_id, disabled_at from users where id = ?").get(userId) as
        | { desk_id: string | null; disabled_at: number | null }
        | undefined;
      if (!row || row.disabled_at !== null) return { deskId: null, changed: false };
      const current = row.desk_id;
      if (current !== null && deskIds.includes(current)) return { deskId: current, changed: false };
      const taken = new Set((this.db.prepare("select desk_id from users where desk_id is not null").all() as { desk_id: string }[]).map((r) => r.desk_id));
      const free = deskIds.find((id) => !taken.has(id)) ?? null;
      if (free === current) return { deskId: current, changed: false };
      this.db.prepare("update users set desk_id = ? where id = ?").run(free, userId);
      return { deskId: free, changed: true };
    }).immediate();
  }

  /** Dono de cada mesa, entre as contas ativas. */
  owners(): Map<string, Person> {
    const rows = this.db.prepare("select id, name, desk_id from users where desk_id is not null and disabled_at is null").all() as {
      id: number;
      name: string;
      desk_id: string;
    }[];
    return new Map(rows.map((row) => [row.desk_id, { id: row.id, name: row.name }]));
  }

  /** Quem fechou a mesa, entre as contas ativas. */
  closedOwners(): Set<number> {
    const rows = this.db.prepare("select id from users where desk_closed = 1 and disabled_at is null").all() as { id: number }[];
    return new Set(rows.map((row) => row.id));
  }

  setClosed(userId: number, closed: boolean): void {
    this.db.prepare("update users set desk_closed = ? where id = ?").run(closed ? 1 : 0, userId);
  }
}
