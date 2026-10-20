import type { AgentInfo, DeskInfo, OfficeMap } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { layoutDesks, robotLook } from "../src/game/desk-layout";

const map: OfficeMap = {
  tileSize: 16,
  cols: 20,
  rows: 10,
  widthPx: 320,
  heightPx: 160,
  backgroundColor: null,
  spawn: { x: 8, y: 8 },
  tilesetImage: "tiles.png",
  seats: [],
  props: [],
  desks: [
    { id: "mesa-1", zone: { x: 0, y: 0, width: 96, height: 64 }, slots: [{ x: 40, y: 8 }, { x: 56, y: 8 }, { x: 56, y: 24 }] },
    { id: "mesa-2", zone: { x: 112, y: 0, width: 96, height: 64 }, slots: [{ x: 150, y: 8 }] },
    { id: "mesa-3", zone: { x: 224, y: 0, width: 96, height: 64 }, slots: [] },
  ],
};
const desks = new Map<string, DeskInfo>([
  ["mesa-1", { id: "mesa-1", ownerId: 1, ownerName: "ana" }],
  ["mesa-2", { id: "mesa-2", ownerId: 2, ownerName: "bia" }],
  ["mesa-3", { id: "mesa-3", ownerId: null, ownerName: null }],
]);
let next = 0;
const agent = (ownerId: number, label: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id: `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
  ownerId,
  ownerName: "x",
  label,
  status: "idle",
  connected: true,
  ownerAway: false,
  ...extra,
});

describe("layoutDesks", () => {
  it("põe os robôs nas posições da mesa do dono, na ordem do rótulo, e o resto vira +N", () => {
    const agents = [agent(1, "e"), agent(1, "b"), agent(1, "d"), agent(1, "a"), agent(1, "c"), agent(2, "site"), agent(3, "sem-mesa")];
    const [one, two, three] = layoutDesks(map, desks, agents);
    expect(one!.robots.map((robot) => [robot.agent.label, robot.at])).toEqual([
      ["a", { x: 40, y: 8 }],
      ["b", { x: 56, y: 8 }],
      ["c", { x: 56, y: 24 }],
    ]);
    expect(one!.extra).toBe(2);
    expect(one!.ownerName).toBe("ana");
    expect(one!.plate).toEqual({ x: 48, y: -2 });
    expect(one!.extraAt).toEqual({ x: 76, y: 20 });
    expect(two!.robots.map((robot) => robot.agent.label)).toEqual(["site"]);
    expect(two!.extra).toBe(0);
    expect(three).toMatchObject({ deskId: "mesa-3", ownerName: null, robots: [], extra: 0 });
    const shown = layoutDesks(map, desks, agents).flatMap((view) => view.robots.map((robot) => robot.agent.label));
    expect(shown).not.toContain("sem-mesa");
  });

  it("mesa sem posições mostra tudo como +N no meio da zona", () => {
    const owned = new Map(desks).set("mesa-3", { id: "mesa-3", ownerId: 4, ownerName: "caio" });
    const view = layoutDesks(map, owned, [agent(4, "x")])[2]!;
    expect(view.robots).toEqual([]);
    expect(view.extra).toBe(1);
    expect(view.extraAt).toEqual({ x: 272, y: 32 });
  });
});

describe("robotLook", () => {
  it("esmaece quando a ponte caiu ou o dono saiu, e a cor do ponto segue o status", () => {
    expect(robotLook(agent(1, "a", { status: "working" }))).toEqual({ alpha: 1, dot: 0x38d973, note: null });
    expect(robotLook(agent(1, "a"))).toEqual({ alpha: 1, dot: 0x9aa3b2, note: null });
    expect(robotLook(agent(1, "a", { ownerAway: true }))).toEqual({ alpha: 0.5, dot: 0x9aa3b2, note: "dono fora" });
    expect(robotLook(agent(1, "a", { connected: false, ownerAway: true }))).toEqual({ alpha: 0.5, dot: 0xf4b41b, note: "reconectando" });
  });
});
