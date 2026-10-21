import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MapError, deskAt, inZone, parseOfficeMap } from "../src/map.js";

// JSON do Tiled, mexido à vontade nos testes.
type Json = any;

const officeJson = (): Json => JSON.parse(readFileSync(new URL("../../../assets/map/office.tmj", import.meta.url), "utf8"));
const objectsOf = (map: Json): Json[] => map.layers.find((layer: Json) => layer.type === "objectgroup").objects;

function broken(change: (map: Json) => void): Json {
  const map = officeJson();
  change(map);
  return map;
}

const expectMapError = (raw: unknown, message: RegExp) => {
  expect(() => parseOfficeMap(raw)).toThrow(MapError);
  expect(() => parseOfficeMap(raw)).toThrow(message);
};

const seatObject = (dir: unknown, x = 72) => ({ id: 900, name: "", type: "seat", point: true, x, y: 100, width: 0, height: 0, properties: [{ name: "dir", type: "string", value: dir }] });
const propObject = (sprite: unknown, x = 80) => ({ id: 901, name: "", type: "prop", point: true, x, y: 90, width: 0, height: 0, properties: [{ name: "sprite", type: "string", value: sprite }] });

describe("parseOfficeMap", () => {
  it("lê o mapa do repositório: 8 mesas com 3 posições de robô, entrada, assentos, móveis e um tileset embutido", () => {
    const map = parseOfficeMap(officeJson());
    expect(map).toMatchObject({ tileSize: 32, cols: 26, rows: 19, widthPx: 832, heightPx: 608, backgroundColor: "#2e2a3a", tilesetImage: "office.png" });
    expect(map.spawn).toEqual({ x: 288, y: 304 });
    expect(map.desks.map((desk) => desk.id)).toEqual(["mesa-1", "mesa-2", "mesa-3", "mesa-4", "mesa-5", "mesa-6", "mesa-7", "mesa-8"]);
    expect(map.desks[0]).toEqual({
      id: "mesa-1",
      zone: { x: 36, y: 144, width: 120, height: 88 },
      slots: [
        { x: 118, y: 186 },
        { x: 142, y: 200 },
        { x: 118, y: 216 },
      ],
    });
    expect(map.desks.every((desk) => desk.slots.length === 3)).toBe(true);
    expect(map.seats).toHaveLength(20);
    expect(map.seats[0]).toEqual({ x: 72, y: 198, dir: "up" });
    expect(map.props).toHaveLength(45);
    expect(map.props[0]).toEqual({ x: 72, y: 179, sprite: "desk-wood" });
  });

  it("acha a mesa pela posição e aceita folga nas bordas", () => {
    const map = parseOfficeMap(officeJson());
    expect(deskAt(map, { x: 100, y: 200 })?.id).toBe("mesa-1");
    expect(deskAt(map, { x: 200, y: 200 })?.id).toBe("mesa-2");
    expect(deskAt(map, map.spawn)).toBeNull();
    const zone = { x: 0, y: 0, width: 32, height: 32 };
    expect(inZone(zone, { x: 40, y: 10 })).toBe(false);
    expect(inZone(zone, { x: 40, y: 10 }, 16)).toBe(true);
    expect(inZone(zone, { x: 49, y: 10 }, 16)).toBe(false);
  });

  it("lê assentos e móveis, na ordem do mapa", () => {
    const map = parseOfficeMap(broken((tiled) => objectsOf(tiled).push(seatObject("up"), propObject("desk-wood"))));
    expect(map.seats.at(-1)).toEqual({ x: 72, y: 100, dir: "up" });
    expect(map.props.at(-1)).toEqual({ x: 80, y: 90, sprite: "desk-wood" });
  });

  it("arredonda o assento para pixels inteiros, como as posições que os clientes enviam", () => {
    const map = parseOfficeMap(broken((tiled) => objectsOf(tiled).push({ ...seatObject("up", 72.4), y: 99.6 })));
    expect(map.seats.at(-1)).toEqual({ x: 72, y: 100, dir: "up" });
  });

  it("recusa o que o escritório não sabe usar, dizendo o motivo", () => {
    expectMapError("x", /formato/);
    expectMapError("{", /formato/);
    expectMapError(broken((map) => (map.tilesets = [{ firstgid: 1, source: "kenney.tsx" }])), /tileset externo/);
    expectMapError(broken((map) => map.tilesets.push({ ...map.tilesets[0], firstgid: 2000, name: "outro" })), /um tileset/);
    expectMapError(broken((map) => (map.tilesets[0].image = "../segredo.png")), /imagem/);
    expectMapError(broken((map) => (map.layers[0].data = [1, 2, 3])), /camada floor/);
    expectMapError(broken((map) => (objectsOf(map)[1].name = "")), /mesa com nome inválido/);
    expectMapError(broken((map) => (objectsOf(map)[2].name = "mesa-1")), /mesa repetida: mesa-1/);
    expectMapError(broken((map) => (objectsOf(map)[1].x = 5000)), /mesa-1 fora do mapa/);
    expectMapError(broken((map) => (objectsOf(map)[9].properties[0].value = "mesa-99")), /mesa-99/);
    expectMapError(broken((map) => objectsOf(map).push({ ...objectsOf(map)[9], id: 999 })), /mais de 3/);
    expectMapError(broken((map) => objectsOf(map).splice(0, 1)), /entrada/);
    expectMapError(broken((map) => (map.infinite = true)), /infinito/);
    expectMapError(broken((map) => objectsOf(map).push(seatObject("sideways"))), /assento com direção inválida: sideways/);
    expectMapError(broken((map) => objectsOf(map).push(seatObject("up", -1))), /assento fora do mapa/);
    expectMapError(broken((map) => objectsOf(map).push(propObject("../segredo"))), /prop com sprite inválido: \.\.\/segredo/);
    expectMapError(broken((map) => objectsOf(map).push(propObject("desk-wood", 99_999))), /prop desk-wood fora do mapa/);
  });
});
