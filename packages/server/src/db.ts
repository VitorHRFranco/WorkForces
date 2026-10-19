import Database from "better-sqlite3";

export type Db = Database.Database;

/** Cada item é uma versão; nunca altere uma migração já publicada, acrescente outra. */
const MIGRATIONS: readonly string[] = [
  `create table users (
     id integer primary key,
     name text not null,
     name_key text not null unique,
     password_hash text not null,
     is_admin integer not null default 0,
     disabled_at integer,
     created_at integer not null
   );
   create table invites (
     code_hash text primary key,
     created_by integer references users(id),
     is_admin_invite integer not null default 0,
     expires_at integer not null,
     used_at integer
   );
   create table sessions (
     id_hash text primary key,
     user_id integer not null references users(id),
     expires_at integer not null
   );
   create table bridge_tokens (
     id integer primary key,
     user_id integer not null references users(id),
     name text not null,
     token_hash text not null unique,
     created_at integer not null,
     last_used_at integer,
     revoked_at integer
   );`,
  // Plano 3: mesa de cada pessoa (id do objeto `desk` do mapa); uma pessoa por mesa.
  `alter table users add column desk_id text;
   create unique index users_desk_id on users(desk_id) where desk_id is not null;`,
];

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
