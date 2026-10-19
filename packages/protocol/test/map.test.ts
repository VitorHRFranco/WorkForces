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

describe("parseOfficeMap", () => {
  it("lê o mapa do repositório: 8 mesas com 3 posições de robô, entrada e um tileset embutido", () => {
    const map = parseOfficeMap(officeJson());
    expect(map).toMatchObject({ tileSize: 16, cols: 44, rows: 26, widthPx: 704, heightPx: 416, backgroundColor: "#472d3c", tilesetImage: "tiles.png" });
    expect(map.spawn).toEqual({ x: 232, y: 184 });
    expect(map.desks.map((desk) => desk.id)).toEqual(["mesa-1", "mesa-2", "mesa-3", "mesa-4", "mesa-5", "mesa-6", "mesa-7", "mesa-8"]);
    expect(map.desks[0]).toEqual({
      id: "mesa-1",
      zone: { x: 32, y: 48, width: 96, height: 64 },
      slots: [
        { x: 88, y: 72 },
        { x: 104, y: 72 },
        { x: 104, y: 88 },
      ],
    });
    expect(map.desks.every((desk) => desk.slots.length === 3)).toBe(true);
  });

  it("acha a mesa pela posição e aceita folga nas bordas", () => {
    const map = parseOfficeMap(officeJson());
    expect(deskAt(map, { x: 80, y: 80 })?.id).toBe("mesa-1");
    expect(deskAt(map, { x: 176, y: 80 })?.id).toBe("mesa-2");
    expect(deskAt(map, map.spawn)).toBeNull();
    const zone = { x: 0, y: 0, width: 32, height: 32 };
    expect(inZone(zone, { x: 40, y: 10 })).toBe(false);
    expect(inZone(zone, { x: 40, y: 10 }, 16)).toBe(true);
    expect(inZone(zone, { x: 49, y: 10 }, 16)).toBe(false);
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
  });
});
