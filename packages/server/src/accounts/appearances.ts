import { appearanceKey, parseAppearance, type Appearance } from "@workforces/protocol";
import type { Db } from "../db.js";

/** A aparência escolhida por cada conta (JSON validado na coluna `users.appearance`). */
export class AppearanceStore {
  constructor(private readonly db: Db) {}

  /** A aparência gravada; null se a pessoa nunca escolheu ou se a gravada deixou de valer (catálogo mudou, texto quebrado). */
  get(userId: number): Appearance | null {
    const row = this.db.prepare("select appearance from users where id = ?").get(userId) as { appearance: string | null } | undefined;
    if (!row?.appearance) return null;
    try {
      return parseAppearance(JSON.parse(row.appearance));
    } catch {
      return null;
    }
  }

  set(userId: number, appearance: Appearance): void {
    this.db.prepare("update users set appearance = ? where id = ?").run(appearanceKey(appearance), userId);
  }
}
