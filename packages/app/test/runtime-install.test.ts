import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { rename as fsRename, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRuntimes, ensureRuntime, type CleanupFs, type InstallFs } from "../src/runtime/install.js";
import type { RuntimeSource } from "../src/runtime/layout.js";

const BUILD = "aaaaaaaaaaaa";
const APP = `app-0.1.0-${BUILD}`;

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
  source = { node: join(src, "node", "node.exe"), nodeVersion: "24.9.9", build: BUILD, serverDir: join(src, "server"), bridgeDir: join(src, "bridge") };
  root = join(dir, "runtime-root");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const errno = (code: string) => Object.assign(new Error(code), { code });
/** Uma pasta da app completa, como outra instância deixaria (com o servidor "outra" para dar para saber de quem é). */
const otherInstance = (appDir: string) => {
  put(join(appDir, "server", "embedded.js"), "outra");
  put(join(appDir, "server", "map", "office.tmj"), "mapa");
  put(join(appDir, "bridge", "cli.js"), "cli");
};

/**
 * O disco de verdade, com o rename de uma pasta montada (a de `target`, ou qualquer uma) falhando `failures` vezes com
 * `code`; `onFail` roda antes de cada falha. As esperas só ficam anotadas.
 */
function flakyFs(failures: number, code: string, target?: string, onFail?: () => void): InstallFs & { waits: number[]; removed: string[] } {
  let left = failures;
  const waits: number[] = [];
  const removed: string[] = [];
  return {
    waits,
    removed,
    rename: async (from, to) => {
      if (left > 0 && (target ? from === `${target}.tmp-${process.pid}` : from.includes(".tmp-"))) {
        left--;
        onFail?.();
        throw errno(code);
      }
      await fsRename(from, to);
    },
    rm: async (path, options) => {
      removed.push(path);
      await fsRm(path, options);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  };
}

const tmpLeft = () => readdirSync(root).filter((name) => name.includes(".tmp-"));

describe("ensureRuntime", () => {
  it("primeira vez: copia tudo e aponta para a cópia, não para a fonte", async () => {
    const runtime = await ensureRuntime(source, root, "0.1.0");
    expect(runtime.root).toBe(root);
    expect(runtime.node).toBe(join(root, "node-24.9.9", "node.exe"));
    expect(runtime.serverEntry).toBe(join(root, APP, "server", "embedded.js"));
    expect(runtime.mapFile).toBe(join(root, APP, "server", "map", "office.tmj"));
    expect(runtime.bridgeCli).toBe(join(root, APP, "bridge", "cli.js"));
    for (const path of [runtime.node, runtime.serverEntry, runtime.mapFile, runtime.bridgeCli]) expect(existsSync(path)).toBe(true);
    expect(existsSync(join(root, APP, "server", "node_modules", "better-sqlite3", "x.node"))).toBe(true);
    expect(existsSync(join(root, APP, "bridge", "node_modules", "@lydell", "y.node"))).toBe(true);
    expect(readFileSync(runtime.node, "utf8")).toBe("node");
    expect(readdirSync(root).sort()).toEqual([APP, "node-24.9.9"]);
    expect(runtime.keep.sort()).toEqual([APP, "node-24.9.9"]);
  });

  it("segunda vez com a mesma versão e a mesma montagem: não copia de novo", async () => {
    const first = await ensureRuntime(source, root, "0.1.0");
    const old = new Date(2020, 0, 1);
    utimesSync(first.node, old, old);
    utimesSync(first.serverEntry, old, old);
    const second = await ensureRuntime(source, root, "0.1.0");
    expect(second.serverEntry).toBe(first.serverEntry);
    expect(statSync(first.node).mtimeMs).toBe(old.getTime());
    expect(statSync(first.serverEntry).mtimeMs).toBe(old.getTime());
  });

  it("mesma versão com outra montagem (instalador novo por cima): pasta nova com o servidor novo, e o Node é o mesmo", async () => {
    const a = await ensureRuntime(source, root, "0.1.0");
    writeFileSync(join(source.serverDir, "embedded.js"), "server B");
    const b = await ensureRuntime({ ...source, build: "bbbbbbbbbbbb" }, root, "0.1.0");
    expect(b.serverEntry).toBe(join(root, "app-0.1.0-bbbbbbbbbbbb", "server", "embedded.js"));
    expect(readFileSync(b.serverEntry, "utf8")).toBe("server B");
    expect(readFileSync(a.serverEntry, "utf8")).toBe("server");
    expect(b.node).toBe(a.node);
    expect(b.keep.sort()).toEqual(["app-0.1.0-bbbbbbbbbbbb", "node-24.9.9"]);
  });

  it("app novo com o mesmo Node: o node.exe é o mesmo", async () => {
    const a = await ensureRuntime(source, root, "0.1.0");
    const b = await ensureRuntime(source, root, "0.2.0");
    expect(b.node).toBe(a.node);
    expect(b.serverEntry).toBe(join(root, `app-0.2.0-${BUILD}`, "server", "embedded.js"));
  });

  it("sobra de cópia interrompida: a pasta é refeita e fica completa", async () => {
    put(join(root, `${APP}.tmp-123`, "lixo"), "x");
    put(join(root, APP, "server", "embedded.js"), "metade");
    const runtime = await ensureRuntime(source, root, "0.1.0");
    expect(existsSync(runtime.bridgeCli)).toBe(true);
    expect(existsSync(runtime.mapFile)).toBe(true);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("server");
  });

  it.each(["EPERM", "EACCES", "EBUSY"])("rename preso por instantes (%s): tenta de novo, com espera crescente, e a pasta fica completa", async (code) => {
    const fs = flakyFs(3, code);
    const runtime = await ensureRuntime(source, root, "0.1.0", fs);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("server");
    expect(existsSync(runtime.node)).toBe(true);
    expect(fs.waits).toHaveLength(3);
    expect(fs.waits[1]!).toBeGreaterThan(fs.waits[0]!);
    expect(fs.waits[2]!).toBeGreaterThan(fs.waits[1]!);
    expect(tmpLeft()).toEqual([]);
  });

  it("preso por mais de ~10 s: desiste com o erro e não deixa a cópia pela metade", async () => {
    const fs = flakyFs(Infinity, "EPERM");
    await expect(ensureRuntime(source, root, "0.1.0", fs)).rejects.toMatchObject({ code: "EPERM" });
    const total = fs.waits.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(9_000);
    expect(total).toBeLessThanOrEqual(10_000);
    // A última espera é só o que sobra do prazo; as de antes nunca diminuem.
    const growing = fs.waits.slice(0, -1);
    for (let i = 1; i < growing.length; i++) expect(growing[i]!).toBeGreaterThanOrEqual(growing[i - 1]!);
    expect(tmpLeft()).toEqual([]);
  });

  it("erro que não é de pasta presa (disco cheio): falha na hora, sem esperar", async () => {
    const fs = flakyFs(1, "ENOSPC");
    await expect(ensureRuntime(source, root, "0.1.0", fs)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(fs.waits).toEqual([]);
    expect(tmpLeft()).toEqual([]);
  });

  it("rename preso enquanto outra instância termina a mesma pasta: aceita a dela", async () => {
    const appDir = join(root, APP);
    const fs = flakyFs(1, "EPERM", appDir, () => otherInstance(appDir));
    const runtime = await ensureRuntime(source, root, "0.1.0", fs);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("outra");
    expect(tmpLeft()).toEqual([]);
  });

  it("o rename falha porque a outra instância pôs a pasta no lugar no mesmo instante: aceita a dela, sem esperar", async () => {
    const appDir = join(root, APP);
    const fs = flakyFs(Infinity, "ENOTEMPTY", appDir, () => otherInstance(appDir));
    const runtime = await ensureRuntime(source, root, "0.1.0", fs);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("outra");
    expect(fs.waits).toEqual([]);
    expect(tmpLeft()).toEqual([]);
  });

  it("outra instância termina a pasta enquanto esta copia: a dela fica (nada apaga uma pasta completa)", async () => {
    const appDir = join(root, APP);
    const fs = flakyFs(0, "EPERM");
    const rm = fs.rm;
    let copying = false;
    fs.rm = async (path, options) => {
      await rm(path, options);
      // A limpeza do `.tmp-` vem logo antes da cópia: é o momento em que a outra instância termina a dela.
      if (!copying && path === `${appDir}.tmp-${process.pid}`) {
        copying = true;
        otherInstance(appDir);
      }
    };
    const runtime = await ensureRuntime(source, root, "0.1.0", fs);
    expect(readFileSync(runtime.serverEntry, "utf8")).toBe("outra");
    expect(fs.removed).not.toContain(appDir);
    expect(tmpLeft()).toEqual([]);
  });
});

describe("cleanupRuntimes", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  /** O disco de verdade; `alive` diz quais pids contam como processos vivos. */
  const diskFs = (alive: (pid: number) => boolean = () => false): CleanupFs & { renamed: string[] } => {
    const renamed: string[] = [];
    return {
      renamed,
      readdir: async (path) => readdirSync(path),
      rename: async (from, to) => {
        renamed.push(from);
        await fsRename(from, to);
      },
      rm: (path, options) => fsRm(path, options),
      alive,
    };
  };
  const seed = () => {
    for (const name of ["node-24.9.9", "app-0.2.0-x", "app-0.1.0", "app-0.2.0-x.tmp-9"]) put(join(root, name, "f"), "x");
  };

  it("apaga versões antigas e sobras; mantém o que está em keep", async () => {
    seed();
    await cleanupRuntimes(root, ["node-24.9.9", "app-0.2.0-x"], diskFs());
    expect(readdirSync(root).sort()).toEqual(["app-0.2.0-x", "node-24.9.9"]);
  });

  it("pasta em uso (rename falha com EBUSY) fica, e o erro só vai ao log", async () => {
    seed();
    put(join(root, "node-22.0.0", "node.exe"), "x");
    const fs = diskFs();
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (from.endsWith("node-22.0.0")) throw errno("EBUSY");
      await rename(from, to);
    };
    await expect(cleanupRuntimes(root, ["node-24.9.9", "app-0.2.0-x"], fs)).resolves.toBeUndefined();
    expect(readdirSync(root).sort()).toEqual(["app-0.2.0-x", "node-22.0.0", "node-24.9.9"]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("só mexe no que é do runtime: arquivo e pasta estranhos na raiz ficam", async () => {
    seed();
    put(join(root, "notas.txt"), "x");
    put(join(root, "outra-coisa", "f"), "x");
    put(join(root, "nodejs", "node.exe"), "x");
    await cleanupRuntimes(root, ["node-24.9.9", "app-0.2.0-x"], diskFs());
    expect(readdirSync(root).sort()).toEqual(["app-0.2.0-x", "node-24.9.9", "nodejs", "notas.txt", "outra-coisa"]);
  });

  it("sobra que já foi renomeada (.old-): apaga direto, sem somar outro sufixo", async () => {
    put(join(root, "app-0.1.0.old-77", "f"), "x");
    put(join(root, "node-22.0.0.old-77.old-78", "f"), "x");
    const fs = diskFs();
    await cleanupRuntimes(root, [], fs);
    expect(fs.renamed).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  it("cópia em andamento de um processo vivo (.tmp-<pid>) fica; a de um processo morto sai", async () => {
    put(join(root, "app-0.2.0-x.tmp-111", "f"), "x");
    put(join(root, "app-0.2.0-x.tmp-222", "f"), "x");
    await cleanupRuntimes(root, [], diskFs((pid) => pid === 111));
    expect(readdirSync(root)).toEqual(["app-0.2.0-x.tmp-111"]);
  });

  it("sem fs falso: o próprio processo conta como vivo", async () => {
    put(join(root, `app-0.2.0-x.tmp-${process.pid}`, "f"), "x");
    await cleanupRuntimes(root, []);
    expect(readdirSync(root)).toEqual([`app-0.2.0-x.tmp-${process.pid}`]);
  });
});
