import { describe, expect, it } from "vitest";
import { reconnectDelay } from "../src/net/backoff.js";

describe("reconnectDelay", () => {
  it("cresce de 1 s até 30 s com variação", () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(1000);
    expect(reconnectDelay(0, () => 0)).toBe(800);
    expect(reconnectDelay(3, () => 0.5)).toBe(8000);
    expect(reconnectDelay(10, () => 1)).toBe(30000);
  });
});
