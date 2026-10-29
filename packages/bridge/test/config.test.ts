import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configDir } from "../src/config.js";

describe("configDir", () => {
  it("usa WORKFORCES_HOME quando definido", () => {
    expect(configDir({ WORKFORCES_HOME: join("x", "wf") })).toBe(join("x", "wf"));
  });

  it("sem WORKFORCES_HOME usa ~/.workforces", () => {
    expect(configDir({})).toBe(join(homedir(), ".workforces"));
  });
});
