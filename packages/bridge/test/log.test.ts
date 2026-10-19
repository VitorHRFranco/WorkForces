import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileLogger } from "../src/log.js";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const cleanTempDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
};

afterEach(cleanTempDirs);

describe("fileLogger", () => {
  it("acrescenta linhas com data em bridge.log, criando a pasta", () => {
    const dir = join(tempDir("wf-log-"), "sub");
    const log = fileLogger(dir);
    log("primeira");
    log("segunda");
    const lines = readFileSync(join(dir, "bridge.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* primeira$/);
    expect(lines[1]).toMatch(/ segunda$/);
  });
});
