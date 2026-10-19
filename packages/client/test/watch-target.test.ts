import type { AgentInfo } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { watchTarget } from "../src/office/watch-target";

const agent = (id: string): AgentInfo => ({ id, ownerId: 1, ownerName: "ana", label: id, status: "idle", connected: true, ownerAway: false });

describe("watchTarget", () => {
  it("mantém o agente escolhido enquanto ele estiver na mesa; senão, o primeiro; mesa vazia, nenhum", () => {
    const agents = [agent("a"), agent("b")];
    expect(watchTarget(agents, "b")).toBe("b");
    expect(watchTarget(agents, null)).toBe("a");
    expect(watchTarget(agents, "sumiu")).toBe("a");
    expect(watchTarget([], "a")).toBeNull();
  });
});
