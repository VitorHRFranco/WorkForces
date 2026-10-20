import { inZone, parseOfficeMap } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import officeTmj from "../../../assets/map/office.tmj?raw";
import { propDef, propOrigin, solidRect } from "../src/game/props";

const repoMap = () => parseOfficeMap(JSON.parse(officeTmj));

describe("móveis", () => {
  it("todo móvel do mapa do repositório tem imagem no atlas", () => {
    const map = repoMap();
    expect(map.props.length).toBeGreaterThan(0);
    expect(map.props.filter((prop) => propDef(prop.sprite) === null).map((prop) => prop.sprite)).toEqual([]);
  });

  it("ninguém entra no mapa preso num móvel", () => {
    const map = repoMap();
    for (const prop of map.props) {
      const solid = solidRect(prop);
      if (solid) expect(inZone(solid, map.spawn), prop.sprite).toBe(false);
    }
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
