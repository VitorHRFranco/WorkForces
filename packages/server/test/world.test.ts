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
