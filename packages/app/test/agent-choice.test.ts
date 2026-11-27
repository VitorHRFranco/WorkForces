import { describe, expect, it } from "vitest";
import { chooseAgent, labelFor } from "../src/agents/agent-choice.js";

const F = "C:\\proj\\teste";
const none = () => null;

describe("labelFor", () => {
  it("o primeiro é o apelido; os seguintes ganham o número", () => {
    expect(labelFor("teste", 1)).toBe("teste");
    expect(labelFor("teste", 2)).toBe("teste 2");
  });
});

describe("chooseAgent", () => {
  it("nenhum aberto, nada guardado: teste, id novo, continua", () => {
    expect(chooseAgent("teste", F, [], none)).toEqual({ label: "teste", agentId: null, resume: true });
  });

  it("nenhum aberto, teste guardado: reaproveita e continua", () => {
    expect(chooseAgent("teste", F, [], (l) => (l === "teste" ? "A" : null))).toEqual({ label: "teste", agentId: "A", resume: true });
  });

  it("teste aberto: teste 2, sem continuar", () => {
    expect(chooseAgent("teste", F, [{ agentId: "A", label: "teste", folder: F }], none)).toEqual({ label: "teste 2", agentId: null, resume: false });
  });

  it("teste 2 aberto e teste guardado: volta a teste, sem continuar", () => {
    const open = [{ agentId: "B", label: "teste 2", folder: F }];
    expect(chooseAgent("teste", F, open, (l) => (l === "teste" ? "A" : null))).toEqual({ label: "teste", agentId: "A", resume: false });
  });

  it("aberto de outra pasta com o mesmo nome não conta", () => {
    expect(chooseAgent("teste", F, [{ agentId: "X", label: "teste", folder: "C:\\outra" }], none)).toEqual({ label: "teste", agentId: null, resume: true });
  });

  it("um id guardado que está aberto (em qualquer pasta) não é reaproveitado", () => {
    const open = [{ agentId: "A", label: "teste", folder: "C:\\outra" }];
    expect(chooseAgent("teste", F, open, () => "A").agentId).toBeNull();
  });

  it("registro antigo sem pasta não conta como aberto da pasta", () => {
    expect(chooseAgent("teste", F, [{ agentId: "Z", label: "teste", folder: null }], none)).toEqual({ label: "teste", agentId: null, resume: true });
  });

  it("teste e teste 2 abertos: teste 3", () => {
    const open = [
      { agentId: "A", label: "teste", folder: F },
      { agentId: "B", label: "teste 2", folder: F },
    ];
    expect(chooseAgent("teste", F, open, none).label).toBe("teste 3");
  });
});
