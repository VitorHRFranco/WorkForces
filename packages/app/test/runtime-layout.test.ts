import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packagedSource, pageFiles, runtimeRootDir, userDataDir } from "../src/runtime/layout.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-layout-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("userDataDir", () => {
  it("sem variável: @workforces/app dentro do appData", () => {
    expect(userDataDir({}, "C:\\Users\\a\\AppData\\Roaming")).toBe(join("C:\\Users\\a\\AppData\\Roaming", "@workforces", "app"));
  });
  it("WF_APP_DATA_DIR vence", () => {
    expect(userDataDir({ WF_APP_DATA_DIR: "x" }, "/appdata")).toBe(resolve("x"));
  });
});

describe("runtimeRootDir", () => {
  it("Windows com LOCALAPPDATA", () => {
    expect(runtimeRootDir({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32", "/u")).toBe(join("C:\\Users\\a\\AppData\\Local", "WorkForces", "runtime"));
  });
  it("Linux: runtime dentro da pasta de dados", () => {
    expect(runtimeRootDir({ LOCALAPPDATA: "/l" }, "linux", "/u")).toBe(join("/u", "runtime"));
  });
  it("WF_RUNTIME_DIR vence", () => {
    expect(runtimeRootDir({ WF_RUNTIME_DIR: "r", LOCALAPPDATA: "/l" }, "win32", "/u")).toBe(resolve("r"));
  });
});

describe("packagedSource", () => {
  const info = (value: object) => {
    mkdirSync(join(dir, "runtime"), { recursive: true });
    writeFileSync(join(dir, "runtime", "runtime.json"), JSON.stringify(value));
  };

  it("lê a versão do Node e o carimbo da montagem, e aponta para resources/runtime", () => {
    info({ node: "24.9.9", build: "0123456789ab" });
    const source = packagedSource(dir);
    expect(source.nodeVersion).toBe("24.9.9");
    expect(source.build).toBe("0123456789ab");
    expect(source.node).toBe(join(dir, "runtime", "node", "node.exe"));
    expect(source.serverDir).toBe(join(dir, "runtime", "server"));
    expect(source.bridgeDir).toBe(join(dir, "runtime", "bridge"));
  });

  it("sem a versão do Node: falha", () => {
    info({ build: "0123456789ab" });
    expect(() => packagedSource(dir)).toThrow("runtime.json sem a versão do Node");
  });

  it.each([{}, { build: "" }, { build: "0123456789" }, { build: "0123456789abc" }, { build: "0123456789AB" }, { build: "0123456789ag" }, { build: 123 }])(
    "carimbo ausente ou fora de 12 hex (%j): falha",
    (extra) => {
      info({ node: "24.9.9", ...extra });
      expect(() => packagedSource(dir)).toThrow("runtime.json sem o carimbo da montagem");
    },
  );
});

describe("pageFiles", () => {
  const base = resolve("/app");
  const mainUrl = pathToFileURL(join(base, "packages", "app", "dist", "main.js")).href;
  it("empacotado: client e preload ao lado do main.js", () => {
    expect(pageFiles(true, mainUrl)).toEqual({ clientDir: join(base, "packages", "app", "dist", "client"), preload: join(base, "packages", "app", "dist", "preload.cjs") });
  });
  it("desenvolvimento: client/dist dos pacotes", () => {
    expect(pageFiles(false, mainUrl)).toEqual({ clientDir: join(base, "packages", "client", "dist"), preload: join(base, "packages", "app", "dist", "preload.cjs") });
  });
});
