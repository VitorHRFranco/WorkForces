import { SpawnError } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { spawnErrorText } from "../src/office/spawn-text";

describe("spawnErrorText", () => {
  it("todo motivo de recusa tem um texto em português", () => {
    for (const error of SpawnError.options) expect(spawnErrorText(error), error).toMatch(/\S/);
    expect(spawnErrorText("no-listener")).toContain("workforces ponte");
  });
});
