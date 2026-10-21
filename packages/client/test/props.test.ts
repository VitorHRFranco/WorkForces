import { parseOfficeMap } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import officeTmj from "../../../assets/map/office.tmj?raw";
import { feetBlocked, propDef, propOrigin, solidRect } from "../src/game/props";
import { SIT_RADIUS, standSpot } from "../src/game/seating";

const repoMap = () => parseOfficeMap(JSON.parse(officeTmj));

describe("móveis", () => {
  it("todo móvel do mapa do repositório tem imagem no atlas", () => {
    const map = repoMap();
    expect(map.props.length).toBeGreaterThan(0);
    expect(map.props.filter((prop) => propDef(prop.sprite) === null).map((prop) => prop.sprite)).toEqual([]);
  });

  it("ninguém entra no mapa preso num móvel", () => {
    const map = repoMap();
    const solids = map.props.flatMap((prop) => solidRect(prop) ?? []);
    expect(feetBlocked(map.spawn, solids)).toBe(false);
  });

  it("de todo assento do mapa dá para levantar sem ficar preso, perto o bastante para sentar de novo", () => {
    const map = repoMap();
    const solids = map.props.flatMap((prop) => solidRect(prop) ?? []);
    for (const seat of map.seats) {
      const spot = standSpot(seat, solids);
      expect(feetBlocked(spot, solids), `assento ${seat.x},${seat.y}`).toBe(false);
      expect(Math.hypot(spot.x - seat.x, spot.y - seat.y)).toBeLessThanOrEqual(SIT_RADIUS);
    }
  });

  it("encostar na borda de um móvel não prende; entrar nele, sim", () => {
    const desk = { x: 0, y: 0, width: 40, height: 20 };
    expect(feetBlocked({ x: 20, y: 28 }, [desk])).toBe(false); // pés de 20 a 28: encostam na base
    expect(feetBlocked({ x: 20, y: 27 }, [desk])).toBe(true);
    expect(feetBlocked({ x: 48, y: 10 }, [desk])).toBe(false); // à direita, encostando
  });

  it("o bloqueio fica na base do móvel; cadeiras e quadros não bloqueiam; nome desconhecido não desenha nada", () => {
    expect(solidRect({ sprite: "desk-wood", x: 72, y: 179 })).toEqual({ x: 43, y: 158, width: 58, height: 21 });
    expect(solidRect({ sprite: "chair-back", x: 72, y: 200 })).toBeNull();
    expect(solidRect({ sprite: "painting-a", x: 133, y: 77 })).toBeNull();
    expect(propDef("nao-existe")).toBeNull();
    expect(propDef("constructor")).toBeNull();
    expect(solidRect({ sprite: "nao-existe", x: 0, y: 0 })).toBeNull();
    expect(propOrigin(propDef("painting-a")!)).toEqual({ x: 29, y: 43 });
  });
});
