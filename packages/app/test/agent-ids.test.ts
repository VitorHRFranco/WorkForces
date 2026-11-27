import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentIdStore, MAX_AGENT_IDS, type AgentKey } from "../src/agents/agent-ids.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-agent-ids-"));
  file = join(dir, "agent-ids.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const KEY: AgentKey = { office: "https://escritorio.exemplo", user: "ana", folder: "C:\\proj\\teste", label: "teste" };

describe("AgentIdStore", () => {
  it("chave desconhecida dá null", () => {
    expect(new AgentIdStore(file).get(KEY)).toBeNull();
  });

  it("guarda e outra instância lê do mesmo arquivo", () => {
    const id = randomUUID();
    new AgentIdStore(file).set(KEY, id);
    expect(new AgentIdStore(file).get(KEY)).toBe(id);
  });

  it("a mesma chave substitui o id", () => {
    const store = new AgentIdStore(file);
    store.set(KEY, randomUUID());
    const second = randomUUID();
    store.set(KEY, second);
    expect(store.get(KEY)).toBe(second);
  });

  it("outra pasta (ou conta) com o mesmo nome não reaproveita", () => {
    const store = new AgentIdStore(file);
    store.set(KEY, randomUUID());
    expect(store.get({ ...KEY, folder: "C:\\outra\\teste" })).toBeNull();
    expect(store.get({ ...KEY, user: "bia" })).toBeNull();
    expect(store.get({ ...KEY, office: "https://outro.exemplo" })).toBeNull();
  });

  it("arquivo ilegível vira vazio, com aviso no log", () => {
    writeFileSync(file, "{ isto não é json");
    const logs: string[] = [];
    expect(new AgentIdStore(file, (message) => logs.push(message)).get(KEY)).toBeNull();
    expect(logs).toHaveLength(1);
  });

  it("acima do teto, sai a mais antiga", () => {
    const store = new AgentIdStore(file);
    for (let i = 0; i <= MAX_AGENT_IDS; i++) store.set({ ...KEY, label: `teste ${i}` }, randomUUID());
    expect(store.get({ ...KEY, label: "teste 0" })).toBeNull();
    expect(store.get({ ...KEY, label: `teste ${MAX_AGENT_IDS}` })).not.toBeNull();
  });
});
