import { LEGACY, appearanceKey } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { AppearanceStore } from "../src/accounts/appearances.js";
import { openDb } from "../src/db.js";

function setup() {
  const db = openDb(":memory:");
  db.prepare("insert into users (name, name_key, password_hash, created_at) values ('ana', 'ana', 'x', 0)").run();
  const id = (db.prepare("select id from users").get() as { id: number }).id;
  return { db, id, store: new AppearanceStore(db) };
}

describe("AppearanceStore", () => {
  it("sem nada gravado, get dá null", () => {
    const { store, id } = setup();
    expect(store.get(id)).toBeNull();
  });

  it("grava e devolve uma aparência igual", () => {
    const { store, id } = setup();
    store.set(id, LEGACY[3]!);
    expect(appearanceKey(store.get(id)!)).toBe(appearanceKey(LEGACY[3]!));
  });

  it("aparência de catálogo antigo ou texto quebrado sai null", () => {
    const { store, db, id } = setup();
    db.prepare("update users set appearance = ? where id = ?").run(JSON.stringify({ ...LEGACY[0]!, v: 0 }), id);
    expect(store.get(id)).toBeNull();
    db.prepare("update users set appearance = ? where id = ?").run("{quebrado", id);
    expect(store.get(id)).toBeNull();
  });
});
