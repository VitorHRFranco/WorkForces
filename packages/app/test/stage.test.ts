import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddedServer } from "../src/host/server-process.js";
import { bundle, copyPackage, markAsModule, nodeUrl, packageDir, runtimeBuild, sha256, stagedPackageJson, stageNode, writeRuntimeInfo } from "../release/stage.js";

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const target = `${process.platform}-${process.arch}`;
// Montado fora do repositório: o Node não pode achar nada no node_modules dele por engano.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-stage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = netServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

describe("peças da montagem", () => {
  it("o package.json do app instalado", () => {
    expect(stagedPackageJson({ version: "0.3.0" }, "3.3.3")).toEqual({
      name: "workforces",
      productName: "WorkForces",
      version: "0.3.0",
      type: "module",
      main: "main.js",
      dependencies: { koffi: "3.3.3" },
    });
  });

  it("o endereço do node.exe", () => {
    expect(nodeUrl("24.1.0")).toBe("https://nodejs.org/dist/v24.1.0/win-x64/node.exe");
  });

  it("o SHA-256 de um arquivo", async () => {
    const file = join(dir, "abc.txt");
    writeFileSync(file, "abc");
    expect(await sha256(file)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("o node.exe conferido", () => {
  const exe = () => {
    const file = join(dir, "node-baixado.exe");
    writeFileSync(file, "abc");
    return file;
  };

  it("hash diferente do esperado: lança e não grava nada em runtime/node", async () => {
    const runtime = join(dir, "runtime");
    await expect(stageNode({ version: "24.1.0", sha256: "0".repeat(64) }, runtime, exe())).rejects.toThrow("o node.exe baixado não confere com release/node.json");
    expect(existsSync(join(runtime, "node"))).toBe(false);
  });

  it("hash igual: grava o node.exe", async () => {
    const runtime = join(dir, "runtime");
    await stageNode({ version: "24.1.0", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }, runtime, exe());
    expect(readFileSync(join(runtime, "node", "node.exe"), "utf8")).toBe("abc");
  });
});

describe("o carimbo da montagem", () => {
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const seed = (): string => {
    const runtime = join(dir, "runtime");
    put(join(runtime, "server", "embedded.js"), "servidor");
    put(join(runtime, "server", "node_modules", "better-sqlite3", "x.node"), "nativo");
    put(join(runtime, "bridge", "cli.js"), "ponte");
    put(join(runtime, "bridge", "node_modules", "@lydell", "y.node"), "nativo");
    put(join(runtime, "node", "node.exe"), "node");
    return runtime;
  };

  it("12 hex, o mesmo para a mesma montagem", () => {
    const runtime = seed();
    expect(runtimeBuild(runtime)).toMatch(/^[0-9a-f]{12}$/);
    expect(runtimeBuild(runtime)).toBe(runtimeBuild(runtime));
  });

  it("muda quando um arquivo do servidor ou da ponte muda, entra ou troca de nome", () => {
    const runtime = seed();
    const base = runtimeBuild(runtime);
    const changed = (edit: () => void, undo: () => void): string => {
      edit();
      try {
        return runtimeBuild(runtime);
      } finally {
        undo();
      }
    };
    const native = join(runtime, "server", "node_modules", "better-sqlite3", "x.node");
    expect(changed(() => writeFileSync(native, "outro"), () => writeFileSync(native, "nativo"))).not.toBe(base);
    const cli = join(runtime, "bridge", "cli.js");
    expect(changed(() => writeFileSync(cli, "ponte nova"), () => writeFileSync(cli, "ponte"))).not.toBe(base);
    const extra = join(runtime, "bridge", "node_modules", "@lydell", "z.node");
    expect(changed(() => writeFileSync(extra, "nativo"), () => rmSync(extra))).not.toBe(base);
    const moved = join(runtime, "bridge", "node_modules", "@lydell", "w.node");
    const pty = join(runtime, "bridge", "node_modules", "@lydell", "y.node");
    expect(changed(() => renameSync(pty, moved), () => renameSync(moved, pty))).not.toBe(base);
    expect(runtimeBuild(runtime)).toBe(base);
  });

  it("o que fica fora do servidor e da ponte não conta", () => {
    const runtime = seed();
    const base = runtimeBuild(runtime);
    writeFileSync(join(runtime, "node", "node.exe"), "outro node");
    writeFileSync(join(runtime, "runtime.json"), "{}");
    expect(runtimeBuild(runtime)).toBe(base);
  });

  it("o runtime.json leva a versão do Node e o carimbo", () => {
    const runtime = seed();
    writeRuntimeInfo(runtime, "24.1.0");
    expect(JSON.parse(readFileSync(join(runtime, "runtime.json"), "utf8"))).toEqual({ node: "24.1.0", build: runtimeBuild(runtime) });
  });
});

describe("arquivos únicos", () => {
  it("o servidor empacotado sobe e chega ao ready", async () => {
    const out = join(dir, "server");
    await bundle(repo("packages/server/dist/embedded.js"), join(out, "embedded.js"), ["better-sqlite3", "bufferutil", "utf-8-validate"]);
    markAsModule(out);
    copyPackage(packageDir(repo("packages/server/package.json"), "better-sqlite3"), join(out, "node_modules"), "better-sqlite3", (rel) =>
      ["lib/", "package.json", "LICENSE", `prebuilds/${target}.node`].some((keep) => (keep.endsWith("/") ? rel.startsWith(keep) : rel === keep)),
    );
    cpSync(repo("assets/map"), join(out, "map"), { recursive: true });
    const server = new EmbeddedServer({ log: () => {} });
    try {
      const result = await server.start({
        node: process.execPath,
        entry: join(out, "embedded.js"),
        host: "127.0.0.1",
        port: await freePort(),
        publicUrl: "https://127.0.0.1",
        dataDir: join(dir, "data"),
        mapFile: join(out, "map", "office.tmj"),
      });
      expect(result.ok && result.pin).toHaveLength(43);
    } finally {
      await server.stop(1000);
    }
  }, 60_000);

  it("a ponte empacotada carrega", async () => {
    const out = join(dir, "bridge");
    await bundle(repo("packages/bridge/dist/cli.js"), join(out, "cli.js"), ["@lydell/node-pty"]);
    markAsModule(out);
    const pty = packageDir(repo("packages/bridge/package.json"), "@lydell/node-pty");
    copyPackage(pty, join(out, "node_modules", "@lydell"), "node-pty");
    copyPackage(packageDir(join(pty, "package.json"), `@lydell/node-pty-${target}`), join(out, "node_modules"), `@lydell/node-pty-${target}`);
    const run = spawnSync(process.execPath, [join(out, "cli.js")], { encoding: "utf8", cwd: dir });
    expect(run.status).toBe(0);
    expect(run.stdout.startsWith("uso: workforces claude")).toBe(true);
  }, 60_000);
});
