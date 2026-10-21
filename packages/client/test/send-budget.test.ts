import { describe, expect, it } from "vitest";
import { SEND_LIMITS, SendBudget } from "../src/office/send-budget";

describe("SendBudget", () => {
  it("fica abaixo dos limites do servidor, por tipo de mensagem, numa janela de 1 s", () => {
    const budget = new SendBudget();
    const allowed = (kind: "move" | "chat" | "watch", count: number, now: number) =>
      Array.from({ length: count }, () => budget.allow(kind, now)).filter(Boolean).length;
    expect(allowed("move", 20, 0)).toBe(SEND_LIMITS.move);
    expect(allowed("chat", 10, 0)).toBe(SEND_LIMITS.chat);
    expect(allowed("watch", 20, 0)).toBe(SEND_LIMITS.watch);
    expect(budget.allow("move", 999)).toBe(false);
    expect(budget.allow("move", 1000)).toBe(true);
    expect(SEND_LIMITS.move).toBeLessThan(20);
    expect(SEND_LIMITS.chat).toBeLessThan(5);
    expect(SEND_LIMITS.watch).toBeLessThan(20);
  });

  it("diz quando abre a próxima vaga", () => {
    const budget = new SendBudget();
    expect(budget.nextAllowedAt("watch", 0)).toBe(0);
    for (let i = 0; i < SEND_LIMITS.watch; i++) budget.allow("watch", i * 10);
    expect(budget.nextAllowedAt("watch", 500)).toBe(1_000);
    expect(budget.nextAllowedAt("watch", 1_000)).toBe(1_000);
  });
});
