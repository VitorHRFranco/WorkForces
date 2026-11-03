import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRecordStore, MAX_RECORDS, type AgentRecord } from "../src/agents/records.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-records-"));
  file = join(dir, "local-agents.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    channelId: randomBytes(16).toString("hex"),
    agentId: randomUUID(),
    office: "https://escritorio.exemplo",
    user: "ana",
    at: Date.now(),
    ...overrides,
  };
}

describe("AgentRecordStore", () => {
  it("guarda, relê do arquivo e remove", () => {
    const store = new AgentRecordStore(file);
    const first = record();
    const second = record({ user: "bia" });
    store.add(first);
    store.add(second);

    expect(new AgentRecordStore(file).list()).toEqual([first, second]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1 });

    // O mesmo canal substitui o registro anterior.
    const replaced = { ...first, user: "caio" };
    store.add(replaced);
    expect(store.list()).toEqual([second, replaced]);

    store.remove([first.channelId]);
    expect(new AgentRecordStore(file).list()).toEqual([second]);
  });

  it("arquivo quebrado ou entrada inválida viram lista vazia, sem lançar", () => {
    const logs: string[] = [];
    const store = new AgentRecordStore(file, (message) => logs.push(message));
    expect(store.list()).toEqual([]);
    expect(logs).toEqual([]);

    writeFileSync(file, "{oops");
    expect(store.list()).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(existsSync(`${file}.bad`)).toBe(false);

    writeFileSync(file, JSON.stringify({ version: 2, agents: [] }));
    expect(store.list()).toEqual([]);
    expect(logs).toHaveLength(2);

    const good = record();
    const invalid = [
      record({ channelId: "../../outro" }),
      record({ channelId: "ABCDEF".padEnd(32, "0") }),
      { ...record(), agentId: "nao-e-uuid" },
      record({ office: "" }),
      record({ user: "" }),
      { ...record(), at: "ontem" },
      null,
      "texto",
    ];
    writeFileSync(file, JSON.stringify({ version: 1, agents: [good, ...invalid] }));
    expect(store.list()).toEqual([good]);
  });

  it("guarda no máximo 50; saem os mais antigos", () => {
    const store = new AgentRecordStore(file);
    const all = Array.from({ length: MAX_RECORDS + 3 }, (_, i) => record({ at: 1_000 + i }));
    // Fora de ordem: o que vale é o `at`, não a ordem de chegada.
    for (const entry of [...all].reverse()) store.add(entry);

    const kept = new AgentRecordStore(file).list();
    expect(MAX_RECORDS).toBe(50);
    expect(kept).toHaveLength(MAX_RECORDS);
    expect(kept.map((entry) => entry.at).sort((a, b) => a - b)).toEqual(all.slice(3).map((entry) => entry.at));
  });

  it("falha ao gravar não lança", () => {
    mkdirSync(file);
    const logs: string[] = [];
    const store = new AgentRecordStore(file, (message) => logs.push(message));

    const kept = record();
    expect(() => store.add(kept)).not.toThrow();
    expect(() => store.remove([kept.channelId])).not.toThrow();
    expect(logs.some((message) => message.startsWith("não consegui gravar o local-agents.json"))).toBe(true);
  });
});
