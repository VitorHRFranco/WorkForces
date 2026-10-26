import { describe, expect, it } from "vitest";
import { createAccountServices, disableUser } from "../src/accounts/index.js";
import { openDb } from "../src/db.js";
import { World } from "../src/realtime/world.js";
import { createUser, officeMap } from "./helpers/setup.js";

const IDS = ["mesa-1", "mesa-2"];

describe("DeskStore", () => {
  it("dá a primeira mesa livre na ordem do mapa e a mesma nas próximas vezes; sem mesa livre, nenhuma", async () => {
    const accounts = createAccountServices(openDb(":memory:"), Date.now);
    const ana = await createUser(accounts, "ana");
    const bia = await createUser(accounts, "bia");
    const caio = await createUser(accounts, "caio");
    expect(accounts.desks.ensure(ana.id, IDS)).toEqual({ deskId: "mesa-1", changed: true });
    expect(accounts.desks.ensure(bia.id, IDS)).toEqual({ deskId: "mesa-2", changed: true });
    expect(accounts.desks.ensure(ana.id, IDS)).toEqual({ deskId: "mesa-1", changed: false });
    expect(accounts.desks.ensure(caio.id, IDS)).toEqual({ deskId: null, changed: false });
    expect(accounts.desks.owners()).toEqual(
      new Map([
        ["mesa-1", { id: ana.id, name: "ana" }],
        ["mesa-2", { id: bia.id, name: "bia" }],
      ]),
    );
  });

  it("troca a mesa que saiu do mapa e libera a mesa de quem foi desativado", async () => {
    const accounts = createAccountServices(openDb(":memory:"), Date.now);
    const ana = await createUser(accounts, "ana");
    const bia = await createUser(accounts, "bia");
    accounts.desks.ensure(ana.id, IDS);
    expect(accounts.desks.ensure(ana.id, ["mesa-2"])).toEqual({ deskId: "mesa-2", changed: true });
    disableUser(accounts, ana.id);
    expect(accounts.desks.owners().size).toBe(0);
    expect(accounts.desks.ensure(bia.id, ["mesa-2"])).toEqual({ deskId: "mesa-2", changed: true });
  });

  it("o banco não aceita duas pessoas na mesma mesa", async () => {
    const db = openDb(":memory:");
    const accounts = createAccountServices(db, Date.now);
    const ana = await createUser(accounts, "ana");
    const bia = await createUser(accounts, "bia");
    accounts.desks.ensure(ana.id, IDS);
    expect(() => db.prepare("update users set desk_id = 'mesa-1' where id = ?").run(bia.id)).toThrow(/UNIQUE/);
  });
  it("guarda quem fechou a mesa; conta desativada não conta", async () => {
    const accounts = createAccountServices(openDb(":memory:"), Date.now);
    const ana = await createUser(accounts, "ana");
    const bia = await createUser(accounts, "bia");
    expect(accounts.desks.closedOwners()).toEqual(new Set());
    accounts.desks.setClosed(ana.id, true);
    accounts.desks.setClosed(bia.id, true);
    accounts.desks.setClosed(bia.id, false);
    expect(accounts.desks.closedOwners()).toEqual(new Set([ana.id]));
    disableUser(accounts, ana.id);
    expect(accounts.desks.closedOwners()).toEqual(new Set());
  });

  it("conta desativada não ganha mesa e o disable repetido libera a mesa gravada", async () => {
    const db = openDb(":memory:");
    const accounts = createAccountServices(db, Date.now);
    const ana = await createUser(accounts, "ana");
    const bia = await createUser(accounts, "bia");
    disableUser(accounts, ana.id);
    expect(accounts.desks.ensure(ana.id, IDS)).toEqual({ deskId: null, changed: false });
    db.prepare("update users set desk_id = 'mesa-2' where id = ?").run(ana.id);
    accounts.users.disable(ana.id);
    expect(accounts.desks.ensure(bia.id, ["mesa-2"])).toEqual({ deskId: "mesa-2", changed: true });
  });
});

describe("World: mesas", () => {
  it("lista as mesas na ordem do mapa, com o dono, e avisa o que mudou", () => {
    const world = new World(officeMap(), new Map([["mesa-2", { id: 7, name: "bia" }], ["mesa-99", { id: 9, name: "zé" }]]));
    expect(world.desks()[0]).toEqual({ id: "mesa-1", ownerId: null, ownerName: null, closed: false });
    expect(world.desks()[1]).toEqual({ id: "mesa-2", ownerId: 7, ownerName: "bia", closed: false });
    expect(world.deskIdOf(9)).toBeNull();
    expect(world.setDesk({ id: 8, name: "caio" }, "mesa-1")).toEqual([{ id: "mesa-1", ownerId: 8, ownerName: "caio", closed: false }]);
    expect(world.setDesk({ id: 8, name: "caio" }, "mesa-1")).toEqual([]);
    expect(world.setDesk({ id: 8, name: "caio" }, "mesa-3")).toEqual([
      { id: "mesa-1", ownerId: null, ownerName: null, closed: false },
      { id: "mesa-3", ownerId: 8, ownerName: "caio", closed: false },
    ]);
    expect(world.deskIdOf(8)).toBe("mesa-3");
  });

  it("mesa fechada vale para a pessoa: aparece na mesa dela e segue com ela", () => {
    const world = new World(officeMap(), new Map([["mesa-1", { id: 7, name: "bia" }]]), new Set([7]));
    expect(world.desks()[0]).toEqual({ id: "mesa-1", ownerId: 7, ownerName: "bia", closed: true });
    expect(world.isClosed(7)).toBe(true);
    expect(world.setClosed({ id: 7, name: "bia" }, true)).toEqual([]);
    expect(world.setClosed({ id: 7, name: "bia" }, false)).toEqual([{ id: "mesa-1", ownerId: 7, ownerName: "bia", closed: false }]);
    expect(world.setClosed({ id: 8, name: "caio" }, true)).toEqual([]); // sem mesa: só guarda
    expect(world.setDesk({ id: 8, name: "caio" }, "mesa-2")).toEqual([{ id: "mesa-2", ownerId: 8, ownerName: "caio", closed: true }]);
  });

  it("a mesa reatribuída não fica apontada para o dono antigo", () => {
    const world = new World(officeMap(), new Map([["mesa-1", { id: 7, name: "bia" }]]));
    world.setDesk({ id: 8, name: "caio" }, "mesa-1");
    expect(world.deskIdOf(7)).toBeNull();
    expect(world.deskIdOf(8)).toBe("mesa-1");
  });
});
