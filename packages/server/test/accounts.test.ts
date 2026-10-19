import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_INVITE_TTL_MS, INVITE_TTL_MS, InviteStore } from "../src/accounts/invites.js";
import { hashPassword, verifyPassword } from "../src/accounts/passwords.js";
import { UserStore } from "../src/accounts/users.js";
import { openDb, type Db } from "../src/db.js";

let db: Db;
let clock: { now: number };
let users: UserStore;
let invites: InviteStore;

beforeEach(() => {
  db = openDb(":memory:");
  clock = { now: 1_700_000_000_000 };
  users = new UserStore(db, () => clock.now);
  invites = new InviteStore(db, users, () => clock.now);
});

describe("senhas", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const stored = await hashPassword("senha-forte-123");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("senha-forte-123");
    expect(await verifyPassword("senha-forte-123", stored)).toBe(true);
    expect(await verifyPassword("senha-errada-123", stored)).toBe(false);
    expect(await verifyPassword("qualquer", "lixo")).toBe(false);
  });
});

describe("nomes", () => {
  it.each([
    ["Stra\u00dfe", "STRASSE"],
    ["\u039f\u0394\u039f\u03a3", "\u03bf\u03b4\u03bf\u03c3"],
    ["L\u0131via", "Livia"],
    ["\uff21\uff4e\uff41", "Ana"],
  ])("compara nomes com NFKC e dobra de caixa: %s = %s", async (first, second) => {
    users.insert(first, await hashPassword("senha-forte-123"), false);
    expect(users.nameTaken(second)).toBe(true);
  });
});

describe("convites", () => {
  it("convite de admin cria conta de admin e só vale uma vez", async () => {
    const { code } = invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS });
    expect(invites.isValid(code)).toBe(true);
    const result = await invites.accept(code, "Ana", "senha-forte-123");
    expect(result).toMatchObject({ ok: true, user: { name: "Ana", isAdmin: true } });
    expect(invites.isValid(code)).toBe(false);
    expect(await invites.accept(code, "Bia", "senha-forte-123")).toEqual({ ok: false, reason: "invalid" });
    expect(users.count()).toBe(1);
  });

  it("convite comum cria conta comum; expira depois do prazo", async () => {
    const admin = await invites.accept(invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS }).code, "ana", "senha-forte-123");
    if (!admin.ok) throw new Error("falhou");
    const { code } = invites.create({ createdBy: admin.user.id, isAdmin: false, ttlMs: INVITE_TTL_MS });
    clock.now += INVITE_TTL_MS + 1;
    expect(invites.isValid(code)).toBe(false);
    expect(await invites.accept(code, "bia", "senha-forte-123")).toEqual({ ok: false, reason: "invalid" });
  });

  it("nome repetido não queima o convite (sem diferenciar maiúsculas)", async () => {
    await invites.accept(invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS }).code, "Ana", "senha-forte-123");
    const { code } = invites.create({ createdBy: null, isAdmin: false, ttlMs: INVITE_TTL_MS });
    expect(await invites.accept(code, "ANA", "senha-forte-123")).toEqual({ ok: false, reason: "name-taken" });
    expect(invites.isValid(code)).toBe(true);
  });

  it("código errado não é válido", () => {
    expect(invites.isValid("nao-existe")).toBe(false);
  });
});

describe("UserStore", () => {
  it("autentica por nome sem diferenciar maiúsculas e recusa conta desativada", async () => {
    const result = await invites.accept(invites.create({ createdBy: null, isAdmin: true, ttlMs: ADMIN_INVITE_TTL_MS }).code, "Ana", "senha-forte-123");
    if (!result.ok) throw new Error("falhou");
    expect(await users.authenticate("ana", "senha-forte-123")).toEqual({ id: result.user.id, name: "Ana", isAdmin: true });
    expect(await users.authenticate("ana", "senha-errada-123")).toBeNull();
    expect(await users.authenticate("ninguem", "senha-forte-123")).toBeNull();
    users.disable(result.user.id);
    expect(users.isActive(result.user.id)).toBe(false);
    expect(users.byId(result.user.id)).toBeNull();
    expect(await users.authenticate("ana", "senha-forte-123")).toBeNull();
    expect(users.byNameIncludingDisabled("ANA")).toMatchObject({ name: "Ana", disabled: true });
  });
});
