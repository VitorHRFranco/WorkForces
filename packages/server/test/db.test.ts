import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db.js";

describe("openDb", () => {
  it("cria as tabelas e marca a versão", () => {
    const db = openDb(":memory:");
    const tables = (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(["bridge_tokens", "invites", "sessions", "users"]);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    db.close();
  });

  it("a mesa de cada pessoa começa aberta", () => {
    const db = openDb(":memory:");
    db.prepare("insert into users (name, name_key, password_hash, created_at) values ('ana', 'ana', 'x', 0)").run();
    expect(db.prepare("select desk_closed from users").get()).toEqual({ desk_closed: 0 });
    db.close();
  });

  it("migrar de novo não muda nada", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    db.close();
  });
});
