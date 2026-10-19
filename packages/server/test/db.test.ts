import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db.js";

describe("openDb", () => {
  it("cria as tabelas e marca a versão", () => {
    const db = openDb(":memory:");
    const tables = (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(["bridge_tokens", "invites", "sessions", "users"]);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });

  it("migrar de novo não muda nada", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });
});
