import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileLogger } from "../src/log.js";

describe("fileLogger", () => {
  it("acrescenta linhas com data em bridge.log, criando a pasta", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "wf-log-")), "sub");
    const log = fileLogger(dir);
    log("primeira");
    log("segunda");
    const lines = readFileSync(join(dir, "bridge.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* primeira$/);
    expect(lines[1]).toMatch(/ segunda$/);
  });
});
