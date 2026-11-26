import { describe, expect, it } from "vitest";
import { PageLogGate } from "../src/log/page-log.js";

describe("PageLogGate", () => {
  it("aceita 50 textos em 10 s e recusa o 51º", () => {
    let t = 0;
    const gate = new PageLogGate({ now: () => t });
    for (let i = 0; i < 50; i++) {
      expect(gate.accept(`erro ${i}`)).toBe(`erro ${i}`);
      t += 100;
    }
    expect(gate.accept("mais um")).toBeNull();
  });

  it("depois de 10 s volta a aceitar", () => {
    let t = 0;
    const gate = new PageLogGate({ now: () => t });
    for (let i = 0; i < 50; i++) gate.accept("x");
    expect(gate.accept("x")).toBeNull();
    t = 10_000;
    expect(gate.accept("de novo")).toBe("de novo");
  });

  it("corta o texto longo em 2.000 caracteres", () => {
    const gate = new PageLogGate();
    expect(gate.accept("a".repeat(5_000))).toHaveLength(2_000);
  });

  it("o que não é texto vira null", () => {
    const gate = new PageLogGate();
    expect(gate.accept(42)).toBeNull();
    expect(gate.accept({})).toBeNull();
  });
});
