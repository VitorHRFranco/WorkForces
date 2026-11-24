import { LEGACY } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { World } from "../src/realtime/world.js";
import { officeMap } from "./helpers/setup.js";

const ana = { id: 1, name: "ana" };

describe("World: presença", () => {
  it("entra na entrada, anda dentro dos limites do mapa e volta onde estava", () => {
    const map = officeMap();
    const world = new World(map, new Map());
    expect(world.join(ana, null)).toEqual({ id: 1, name: "ana", x: map.spawn.x, y: map.spawn.y, dir: "down", moving: false, appearance: null });
    expect(world.isOnline(1)).toBe(true);
    expect(world.move(1, 99_999, -5, "right", true)).toEqual({ id: 1, name: "ana", x: map.widthPx, y: 0, dir: "right", moving: true, appearance: null });
    expect(world.move(2, 10, 10, "up", true)).toBeNull();
    world.leave(1);
    expect(world.isOnline(1)).toBe(false);
    expect(world.online()).toEqual([]);
    expect(world.join(ana, null)).toMatchObject({ x: map.widthPx, y: 0, dir: "right", moving: false });
    expect(world.position(1)).toEqual({ x: map.widthPx, y: 0 });
  });
});

describe("World: aparência", () => {
  it("o jogador entra com a aparência dada, ou com null", () => {
    const world = new World(officeMap(), new Map());
    expect(world.join(ana, LEGACY[1]!).appearance).toEqual(LEGACY[1]);
    expect(world.join({ id: 2, name: "bia" }, null).appearance).toBeNull();
  });

  it("setAppearance troca a de quem está online e dá null para quem não está", () => {
    const world = new World(officeMap(), new Map());
    world.join(ana, LEGACY[1]!);
    expect(world.setAppearance(1, LEGACY[2]!)?.appearance).toEqual(LEGACY[2]);
    expect(world.online()[0]!.appearance).toEqual(LEGACY[2]);
    expect(world.setAppearance(9, LEGACY[2]!)).toBeNull();
  });

  it("quem volta aparece com a aparência do join, na posição em que saiu", () => {
    const world = new World(officeMap(), new Map());
    world.join(ana, LEGACY[1]!);
    world.move(1, 50, 60, "left", false);
    world.leave(1);
    const back = world.join(ana, LEGACY[4]!);
    expect(back.appearance).toEqual(LEGACY[4]);
    expect(back).toMatchObject({ x: 50, y: 60, dir: "left" });
  });
});

describe("World: proximidade", () => {
  it("assiste quem está na zona da mesa do dono, com folga de 1 tile", () => {
    const map = officeMap();
    const world = new World(map, new Map([["mesa-1", { id: 2, name: "bia" }]]));
    world.join(ana, null);
    const zone = map.desks[0]!.zone;
    world.move(1, zone.x + 10, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(true);
    world.move(1, zone.x + zone.width + map.tileSize, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(true);
    world.move(1, zone.x + zone.width + map.tileSize + 1, zone.y + 10, "up", false);
    expect(world.canWatch(1, 2)).toBe(false);
    expect(world.canWatch(1, 3)).toBe(false); // dono sem mesa
    expect(world.canWatch(4, 2)).toBe(false); // quem assiste não está online
  });
});

describe("World: chat", () => {
  it("guarda só as últimas 200 mensagens, com id crescente", () => {
    const world = new World(officeMap(), new Map());
    for (let i = 1; i <= 205; i++) world.addChat(ana, `mensagem ${i}`, i);
    const chat = world.chat();
    expect(chat).toHaveLength(200);
    expect(chat[0]).toEqual({ id: 6, fromId: 1, name: "ana", text: "mensagem 6", at: 6 });
    expect(chat.at(-1)?.id).toBe(205);
    chat.pop();
    expect(world.chat()).toHaveLength(200);
  });
});
