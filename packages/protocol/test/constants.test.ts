import { describe, expect, it } from "vitest";
import { CLOSE_CODES, LIMITS, PROTOCOL_VERSION } from "../src/index.js";

describe("constantes do protocolo", () => {
  it("seguem a spec", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(LIMITS).toEqual({ maxCols: 500, maxRows: 200, maxFrameBytes: 262144, maxLabelLength: 64, maxChatLength: 1000, chatHistory: 200 });
    expect(CLOSE_CODES).toEqual({
      invalidMessage: 4000,
      unauthorized: 4001,
      protocolMismatch: 4002,
      originNotAllowed: 4003,
      rateLimited: 4008,
      replacedByNewTab: 4009,
    });
  });
});
