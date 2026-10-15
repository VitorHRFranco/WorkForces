import { describe, expect, it } from "vitest";
import { AgentToServer, FrameBody, PROTOCOL_VERSION, ServerToAgent, parseJson } from "../src/index.js";

const agentId = "0b8e3f2a-5c1d-4e6f-8a7b-9c0d1e2f3a4b";
const hello = { type: "hello", protocol: PROTOCOL_VERSION, kind: "agent", agentId, label: "loja", cols: 120, rows: 40 };
const frame = {
  type: "frame",
  seq: 1,
  key: true,
  cols: 10,
  rows: 2,
  cursor: { x: 0, y: 1, visible: true },
  lines: [[0, "oi"], [1, ""]],
};

describe("AgentToServer", () => {
  it("aceita hello, frame e status válidos", () => {
    expect(AgentToServer.safeParse(hello).success).toBe(true);
    expect(AgentToServer.safeParse(frame).success).toBe(true);
    expect(AgentToServer.safeParse({ type: "status", state: "working" }).success).toBe(true);
  });

  it("recusa rótulo longo, uuid inválido e tela grande demais", () => {
    expect(AgentToServer.safeParse({ ...hello, label: "x".repeat(65) }).success).toBe(false);
    expect(AgentToServer.safeParse({ ...hello, agentId: "abc" }).success).toBe(false);
    expect(AgentToServer.safeParse({ ...hello, cols: 501 }).success).toBe(false);
  });

  it("recusa quadro com linha ou cursor fora da tela", () => {
    expect(AgentToServer.safeParse({ ...frame, lines: [[2, "x"]] }).success).toBe(false);
    expect(AgentToServer.safeParse({ ...frame, cursor: { x: 10, y: 0, visible: true } }).success).toBe(false);
  });

  it("recusa tipos desconhecidos", () => {
    expect(AgentToServer.safeParse({ type: "input", data: "sair\r" }).success).toBe(false);
  });
});

describe("FrameBody", () => {
  it("valida o corpo de um quadro sem o campo type", () => {
    const { type: _type, ...body } = frame;
    expect(FrameBody.safeParse(body).success).toBe(true);
    expect(FrameBody.safeParse({ ...body, seq: 0 }).success).toBe(false);
  });
});

describe("ServerToAgent", () => {
  it("só conhece viewers", () => {
    expect(ServerToAgent.safeParse({ type: "viewers", n: 2 }).success).toBe(true);
    expect(ServerToAgent.safeParse({ type: "viewers", n: -1 }).success).toBe(false);
    expect(ServerToAgent.safeParse({ type: "input", data: "x" }).success).toBe(false);
  });
});

describe("parseJson", () => {
  it("devolve null para JSON quebrado ou mensagem inválida", () => {
    expect(parseJson(ServerToAgent, "{")).toBeNull();
    expect(parseJson(ServerToAgent, '{"type":"viewers","n":"2"}')).toBeNull();
    expect(parseJson(ServerToAgent, '{"type":"viewers","n":2}')).toEqual({ type: "viewers", n: 2 });
  });
});
