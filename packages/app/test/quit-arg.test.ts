import { describe, expect, it } from "vitest";
import { wantsQuit } from "../src/quit-arg.js";

describe("wantsQuit", () => {
  it("só com --quit", () => {
    expect(wantsQuit(["WorkForces.exe", "--quit"])).toBe(true);
    expect(wantsQuit(["WorkForces.exe", "workforces://invite?code=x"])).toBe(false);
    expect(wantsQuit(["WorkForces.exe"])).toBe(false);
  });
});
