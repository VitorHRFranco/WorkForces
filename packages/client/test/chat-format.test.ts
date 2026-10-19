import { describe, expect, it } from "vitest";
import { chatDraft, formatChatTime } from "../src/office/chat-format";

describe("chatDraft", () => {
  it("manda o texto limpo, que o servidor aceita", () => {
    expect(chatDraft("  bom dia  ")).toBe("bom dia");
    expect(chatDraft("")).toBeNull();
    expect(chatDraft("   ")).toBeNull();
    expect(chatDraft("a\nb\tc")).toBe("a b c");
    expect(chatDraft("\u001b[31mvermelho")).toBe("[31mvermelho");
    expect(chatDraft("x".repeat(1200))).toHaveLength(1000);
    expect(chatDraft(`${"a".repeat(999)} b`)).toBe("a".repeat(999));
  });

  it("troca por espaço o que o servidor recusa além do controle comum", () => {
    expect(chatDraft("oi\u2028x")).toBe("oi x");
    expect(chatDraft("a\u202eb")).toBe("a b");
    expect(chatDraft("a\ud800b")).toBe("a b");
  });
});

describe("formatChatTime", () => {
  it("mostra hora e minuto", () => {
    expect(formatChatTime(Date.UTC(2026, 9, 19, 13, 5))).toMatch(/^\d{2}:\d{2}$/);
  });
});
