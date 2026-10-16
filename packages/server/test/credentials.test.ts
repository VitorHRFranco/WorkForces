import { beforeEach, describe, expect, it } from "vitest";
import { createAccountServices, disableUser, type AccountServices } from "../src/accounts/index.js";
import { ADMIN_INVITE_TTL_MS } from "../src/accounts/invites.js";
import { SESSION_TTL_MS } from "../src/accounts/sessions.js";
import type { User } from "../src/accounts/users.js";
import { openDb } from "../src/db.js";

const DAY = 24 * 60 * 60 * 1000;
let accounts: AccountServices;
let clock: { now: number };
let ana: User;

beforeEach(async () => {
  clock = { now: 1_700_000_000_000 };
  accounts = createAccountServices(openDb(":memory:"), () => clock.now);
  const result = await accounts.invites.accept(
    accounts.invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS }).code,
    "ana",
    "senha-forte-123",
  );
  if (!result.ok) throw new Error("falhou");
  ana = result.user;
});

describe("SessionStore", () => {
  it("cria, encontra e apaga sessões", () => {
    const id = accounts.sessions.create(ana.id);
    expect(accounts.sessions.lookup(id)).toEqual(ana);
    expect(accounts.sessions.lookup("outra")).toBeNull();
    expect(accounts.sessions.lookup(null)).toBeNull();
    accounts.sessions.delete(id);
    expect(accounts.sessions.lookup(id)).toBeNull();
  });

  it("expira em 14 dias, mas o uso renova", () => {
    const id = accounts.sessions.create(ana.id);
    clock.now += 8 * DAY;
    expect(accounts.sessions.lookup(id)).toEqual(ana); // renovou: vale até agora + 14 dias
    clock.now += 13 * DAY;
    expect(accounts.sessions.lookup(id)).toEqual(ana);
    clock.now += SESSION_TTL_MS + 1;
    expect(accounts.sessions.lookup(id)).toBeNull();
  });
});

describe("TokenStore", () => {
  it("o token aparece só na criação e é guardado como hash", () => {
    const created = accounts.tokens.create(ana.id, "notebook");
    expect(created.token).toMatch(/^wf_[A-Za-z0-9_-]{40,}$/);
    expect(accounts.tokens.list(ana.id)).toEqual([{ id: created.id, name: "notebook", createdAt: clock.now, lastUsedAt: null }]);
    expect(JSON.stringify(accounts.tokens.list(ana.id))).not.toContain(created.token);
    expect(accounts.tokens.verify(created.token)).toEqual({ tokenId: created.id, user: ana });
    expect(accounts.tokens.verify("wf_errado")).toBeNull();
    expect(accounts.tokens.verify("sem-prefixo")).toBeNull();
  });

  it("revogar invalida o token; touch registra o último uso", () => {
    const created = accounts.tokens.create(ana.id, "notebook");
    accounts.tokens.touch(created.id);
    expect(accounts.tokens.list(ana.id)[0]?.lastUsedAt).toBe(clock.now);
    expect(accounts.tokens.revoke(ana.id + 1, created.id)).toBe(false); // de outra pessoa
    expect(accounts.tokens.revoke(ana.id, created.id)).toBe(true);
    expect(accounts.tokens.verify(created.token)).toBeNull();
    expect(accounts.tokens.isValid(created.id)).toBe(false);
    expect(accounts.tokens.list(ana.id)).toEqual([]);
  });

  it("desativar a conta derruba sessões e tokens", () => {
    const session = accounts.sessions.create(ana.id);
    const token = accounts.tokens.create(ana.id, "notebook");
    disableUser(accounts, ana.id);
    expect(accounts.sessions.lookup(session)).toBeNull();
    expect(accounts.tokens.verify(token.token)).toBeNull();
    expect(accounts.tokens.isValid(token.id)).toBe(false);
  });
});
