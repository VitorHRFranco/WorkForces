import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db.js";

describe("openDb", () => {
  it("cria as tabelas e marca a versão", () => {
    const db = openDb(":memory:");
    const tables = (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(["bridge_tokens", "invites", "sessions", "users"]);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });

  it("a mesa de cada pessoa começa aberta", () => {
    const db = openDb(":memory:");
    db.prepare("insert into users (name, name_key, password_hash, created_at) values ('ana', 'ana', 'x', 0)").run();
    expect(db.prepare("select desk_closed from users").get()).toEqual({ desk_closed: 0 });
    db.close();
  });

  it("a tabela users tem a coluna appearance, vazia para quem nunca escolheu", () => {
    const db = openDb(":memory:");
    const columns = (db.pragma("table_info(users)") as { name: string }[]).map((column) => column.name);
    expect(columns).toContain("appearance");
    db.prepare("insert into users (name, name_key, password_hash, created_at) values ('ana', 'ana', 'x', 0)").run();
    expect(db.prepare("select appearance from users").get()).toEqual({ appearance: null });
    db.close();
  });

  it("um banco já migrado até a versão anterior ganha a coluna sem perder as contas", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 3");
    db.exec("create table users (id integer primary key, name text not null, desk_closed integer not null default 0)");
    db.prepare("insert into users (name) values ('ana')").run();
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    expect(db.prepare("select name, appearance from users").get()).toEqual({ name: "ana", appearance: null });
    db.close();
  });

  it("migrar de novo não muda nada", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });
});
