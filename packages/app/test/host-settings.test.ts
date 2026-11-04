import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostSettingsStore, type HostSettings } from "../src/host/settings.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-host-"));
  file = join(dir, "host.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const settings: HostSettings = { mode: "lan", port: 4600, lanAddress: "192.168.0.10", wanAddress: null, pin: null, lastInviteHost: null };

describe("HostSettingsStore", () => {
  it("sem arquivo, get() dá null", () => {
    expect(HostSettingsStore.load(file, () => {}).get()).toBeNull();
  });

  it("save grava e recarrega", () => {
    HostSettingsStore.load(file, () => {}).save(settings);
    expect(HostSettingsStore.load(file, () => {}).get()).toEqual(settings);
  });

  it.each([
    ["porta 80", { ...settings, port: 80 }],
    ["modo desconhecido", { ...settings, mode: "vpn" }],
  ])("arquivo com %s dá null, avisa e não apaga o arquivo", (_name, content) => {
    const text = JSON.stringify({ version: 1, ...content });
    writeFileSync(file, text);
    const logs: string[] = [];
    expect(HostSettingsStore.load(file, (m) => logs.push(m)).get()).toBeNull();
    expect(logs).toHaveLength(1);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
