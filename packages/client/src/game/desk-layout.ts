import type { AgentInfo, DeskInfo, OfficeMap, Point } from "@workforces/protocol";
import { compareAgents } from "../office/office-state";

export interface RobotSpot {
  agent: AgentInfo;
  at: Point;
}

export interface DeskView {
  deskId: string;
  ownerName: string | null;
  /** Onde fica a plaquinha com o nome do dono (em cima da zona). */
  plate: Point;
  robots: RobotSpot[];
  /** Agentes que não couberam nas posições da mesa. */
  extra: number;
  /** Onde fica o selo "+N". */
  extraAt: Point;
}

/** Onde cada robô aparece (spec 8): nas posições da mesa do dono, na ordem do rótulo; o resto vira "+N". */
export function layoutDesks(map: OfficeMap, desks: ReadonlyMap<string, DeskInfo>, agents: Iterable<AgentInfo>): DeskView[] {
  const byOwner = new Map<number, AgentInfo[]>();
  for (const agent of agents) {
    const list = byOwner.get(agent.ownerId) ?? [];
    list.push(agent);
    byOwner.set(agent.ownerId, list);
  }
  return map.desks.map((desk) => {
    const info = desks.get(desk.id);
    const ownerId = info?.ownerId ?? null;
    const mine = ownerId === null ? [] : [...(byOwner.get(ownerId) ?? [])].sort(compareAgents);
    const shown = mine.slice(0, desk.slots.length);
    const lastSlot = desk.slots[shown.length - 1];
    return {
      deskId: desk.id,
      ownerName: info?.ownerName ?? null,
      plate: { x: desk.zone.x + desk.zone.width / 2, y: desk.zone.y + 6 },
      robots: shown.map((agent, i) => ({ agent, at: desk.slots[i]! })),
      extra: mine.length - shown.length,
      extraAt: lastSlot ? { x: lastSlot.x + 10, y: lastSlot.y - 6 } : { x: desk.zone.x + desk.zone.width / 2, y: desk.zone.y + desk.zone.height / 2 },
    };
  });
}

const GREEN = 0x38d973;
const GRAY = 0x9aa3b2;
const YELLOW = 0xf4b41b;

/** Visual do robô conforme o estado do agente (spec 8: "dono fora" e "reconectando" esmaecidos). */
export function robotLook(agent: AgentInfo): { alpha: number; dot: number; note: string | null } {
  if (!agent.connected) return { alpha: 0.5, dot: YELLOW, note: "reconectando" };
  const dot = agent.status === "working" ? GREEN : GRAY;
  return agent.ownerAway ? { alpha: 0.5, dot, note: "dono fora" } : { alpha: 1, dot, note: null };
}
