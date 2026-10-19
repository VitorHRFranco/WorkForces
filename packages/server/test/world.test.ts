import { describe, expect, it } from "vitest";
import { World } from "../src/realtime/world.js";
import { officeMap } from "./helpers/setup.js";

const ana = { id: 1, name: "ana" };

describe("World: presença", () => {
  it("entra na entrada, anda dentro dos limites do mapa e volta onde estava", () => {
    const world = new World(officeMap(), new Map());
    expect(world.join(ana)).toEqual({ id: 1, name: "ana", x: 232, y: 184, dir: "down", moving: false });
    expect(world.isOnline(1)).toBe(true);
    expect(world.move(1, 99_999, -5, "right", true)).toEqual({ id: 1, name: "ana", x: 704, y: 0, dir: "right", moving: true });
    expect(world.move(2, 10, 10, "up", true)).toBeNull();
    world.leave(1);
    expect(world.isOnline(1)).toBe(false);
    expect(world.online()).toEqual([]);
    expect(world.join(ana)).toMatchObject({ x: 704, y: 0, dir: "right", moving: false });
    expect(world.position(1)).toEqual({ x: 704, y: 0 });
  });
});

describe("World: proximidade", () => {
  it("assiste quem está na zona da mesa do dono, com folga de 1 tile", () => {
    const map = officeMap();
    const world = new World(map, new Map([["mesa-1", { id: 2, name: "bia" }]]));
    world.join(ana);
    const zone = map.desks[0]!.zone; // mesa-1: x 32..128, y 48..112
    world.move(1, zone.x + 10, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(true);
    world.move(1, zone.x + zone.width + 16, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(true);
    world.move(1, zone.x + zone.width + 17, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(false);
    expect(world.canWatch(1, 3)).toBe(false); // dono sem mesa
    expect(world.canWatch(4, 2)).toBe(false); // quem assiste não está online
  });
});
