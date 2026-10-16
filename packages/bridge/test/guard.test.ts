import { describe, expect, it } from "vitest";
import { withSessionGuard } from "../src/guard.js";

describe("withSessionGuard", () => {
  it("avisos do Node vão para o log durante a sessão e os ouvintes voltam ao normal", async () => {
    const logs: string[] = [];
    const before = {
      exceptions: process.listenerCount("uncaughtException"),
      rejections: process.listenerCount("unhandledRejection"),
      warnings: process.listeners("warning"),
    };
    const result = await withSessionGuard(
      (message) => logs.push(message),
      async () => {
        expect(process.listenerCount("uncaughtException")).toBe(before.exceptions + 1);
        expect(process.listenerCount("unhandledRejection")).toBe(before.rejections + 1);
        process.emitWarning("aviso de teste");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(logs.join("\n")).toContain("aviso do Node: aviso de teste");
    expect(process.listenerCount("uncaughtException")).toBe(before.exceptions);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejections);
    expect(process.listeners("warning")).toEqual(before.warnings);
  });
});
