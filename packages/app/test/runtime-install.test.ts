import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { rename as fsRename, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRuntimes, ensureRuntime, type CleanupFs } from "../src/runtime/install.js";
import type { RuntimeSource } from "../src/runtime/layout.js";

let dir: string;
let source: RuntimeSource;
let root: string;
const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-install-"));
  const src = join(dir, "resources", "runtime");
  put(join(src, "node", "node.exe"), "node");
  put(join(src, "server", "embedded.js"), "server");
  put(join(src, "server", "map", "office.tmj"), "mapa");
  put(join(src, "server", "node_modules", "better-sqlite3", "x.node"), "nativo");
  put(join(src, "bridge", "cli.js"), "cli");
  put(join(src, "bridge", "node_modules", "@lydell", "y.node"), "nativo");
  source = { node: join(src, "node", "node.exe"), nodeVersion: "24.9.9", serverDir: join(src, "server"), bridgeDir: join(src, "bridge") };
  root = join(dir, "runtime-root");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureRuntime", () => {
  it("primeira vez: copia tudo e aponta para a cópia, não para a fonte", async () => {
    const runtime = await ensureRuntime(source, root, "0.1.0");
    expect(runtime.root).toBe(root);
    expect(runtime.node).toBe(join(root, "node-24.9.9", "node.exe"));
    expect(runtime.serverEntry).toBe(join(root, "app-0.1.0", "server", "embedded.js"));
    expect(runtime.mapFile).toBe(join(root, "app-0.1.0", "server", "map", "office.tmj"));
    expect(runtime.bridgeCli).toBe(join(root, "app-0.1.0", "bridge", "cli.js"));
    for (const path of [runtime.node, runtime.serverEntry, runtime.mapFile, runtime.bridgeCli]) expect(existsSync(path)).toBe(true);
    expect(existsSync(join(root, "app-0.1.0", "server", "node_modules", "better-sqlite3", "x.node"))).toBe(true);
    expect(existsSync(join(root, "app-0.1.0", "bridge", "node_modules", "@lydell", "y.node"))).toBe(true);
    expect(readFileSync(runtime.node, "utf8")).toBe("node");
    expect(readdirSync(root).sort()).toEqual(["app-0.1.0", "node-24.9.9"]);
  });

  it("segunda vez com a mesma versão: não copia de novo", async () => {
    const first = await ensureRuntime(source, root, "0.1.0");
    const old = new Date(2020, 0, 1);
    utimesSync(first.node, old, old);
    await ensureRuntime(source, root, "0.1.0");
    expect(statSync(first.node).mtimeMs).toBe(old.getTime());
  });

  it("app novo com o mesmo Node: o node.exe é o mesmo", async () => {
    const a = await ensureRuntime(source, root, "0.1.0");
    const b = await ensureRuntime(source, root, "0.2.0");
    expect(b.node).toBe(a.node);
    expect(b.serverEntry).toBe(join(root, "app-0.2.0", "server", "embedded.js"));
  });

  it("sobra de cópia interrompida: a pasta é refeita e fica completa", async () => {
    put(join(root, "app-0.1.0.tmp-123", "lixo"), "x");
    put(join(root, "app-0.1.0", "server", "embedded.js"), "metade");
    const runtime = await ensureRuntime(source, root, "0.1.0");
    expect(existsSync(runtime.bridgeCli)).toBe(true);
    expect(existsSync(runtime.mapFile)).toBe(true);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("server");
  });
});

describe("cleanupRuntimes", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  const seed = () => {
    for (const name of ["node-24.9.9", "app-0.2.0", "app-0.1.0", "app-0.2.0.tmp-9"]) put(join(root, name, "f"), "x");
  };

  it("apaga versões antigas e sobras; mantém o que está em keep", async () => {
    seed();
    await cleanupRuntimes(root, ["node-24.9.9", "app-0.2.0"]);
    expect(readdirSync(root).sort()).toEqual(["app-0.2.0", "node-24.9.9"]);
  });

  it("pasta em uso (rename falha com EBUSY) fica, e o erro só vai ao log", async () => {
    seed();
    put(join(root, "node-22.0.0", "node.exe"), "x");
    const fs: CleanupFs = {
      readdir: async (path) => readdirSync(path),
      rename: async (from, to) => {
        if (from.endsWith("node-22.0.0")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        await fsRename(from, to);
      },
      rm: (path, options) => fsRm(path, options),
    };
    await expect(cleanupRuntimes(root, ["node-24.9.9", "app-0.2.0"], fs)).resolves.toBeUndefined();
    expect(readdirSync(root).sort()).toEqual(["app-0.2.0", "node-22.0.0", "node-24.9.9"]);
    expect(console.warn).toHaveBeenCalled();
  });
});
