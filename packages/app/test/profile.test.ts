import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY } from "@workforces/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileStore } from "../src/profile.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-profile-"));
  file = join(dir, "profile.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ProfileStore", () => {
  it("sem arquivo, não há aparência", () => {
    expect(new ProfileStore(file).appearance()).toBeNull();
  });

  it("a aparência gravada volta num store novo", () => {
    new ProfileStore(file).setAppearance(LEGACY[2]!);
    expect(new ProfileStore(file).appearance()).toEqual(LEGACY[2]);
  });

  it.each(["{", '{"appearance": {"v": 99}}', "[]"])("conteúdo inválido (%s) dá null", (text) => {
    writeFileSync(file, text);
    expect(new ProfileStore(file).appearance()).toBeNull();
  });

  it("não sobra arquivo temporário", () => {
    new ProfileStore(file).setAppearance(LEGACY[0]!);
    expect(readdirSync(dir)).toEqual(["profile.json"]);
  });
});
