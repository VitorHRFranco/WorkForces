// Monta o que o electron-builder empacota: o app, o servidor e a ponte em arquivos únicos, os módulos nativos já
// compilados e o node.exe oficial conferido por SHA-256. Roda com `node release/stage.ts` (Node 24 apaga os tipos):
// só sintaxe apagável e nenhum import de outro .ts. Depois de `pnpm build`.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_BANNER = 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';
const MISMATCH = "o node.exe baixado não confere com release/node.json";

export function stagedPackageJson(app: { version: string }, koffiVersion: string): object {
  return { name: "workforces", productName: "WorkForces", version: app.version, type: "module", main: "main.js", dependencies: { koffi: koffiVersion } };
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export function nodeUrl(version: string): string {
  return `https://nodejs.org/dist/v${version}/win-x64/node.exe`;
}

/** Um arquivo ESM só: o `require` que os pacotes CJS embutidos esperam vem do banner. */
export async function bundle(entry: string, outfile: string, external: string[]): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: { js: RUNTIME_BANNER },
    external,
    logLevel: "warning",
  });
}

/** O `.js` do arquivo único é ESM; sem isso o Node precisaria adivinhar pelo conteúdo. */
export function markAsModule(dir: string): void {
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
}

/** Copia um pacote instalado (seguindo os links do pnpm) para `<toNodeModules>/<name>`, só os arquivos que `keep` aceitar. */
export function copyPackage(fromDir: string, toNodeModules: string, name: string, keep?: (relPath: string) => boolean): void {
  const root = realpathSync(fromDir);
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel))) {
      const path = rel ? `${rel}/${entry}` : entry;
      // `statSync` segue o link: no pnpm, o que parece pasta ou arquivo do pacote pode ser um atalho.
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (!keep || keep(path)) {
        mkdirSync(dirname(join(toNodeModules, name, path)), { recursive: true });
        copyFileSync(join(root, path), join(toNodeModules, name, path));
      }
    }
  };
  walk("");
}

/** A pasta do pacote `name`, como o pacote em `fromPackageJson` o enxerga (no pnpm, é o link do node_modules dele). */
export function packageDir(fromPackageJson: string, name: string): string {
  const entry = createRequire(realpathSync(fromPackageJson)).resolve(name);
  let dir = dirname(entry);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === name) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`não achei a pasta de ${name}`);
    dir = parent;
  }
}

/** Grava o node.exe em `runtimeDir/node` e o runtime.json, mas só depois de conferir o SHA-256. */
export async function stageNode(node: { version: string; sha256: string }, runtimeDir: string, localExe?: string): Promise<void> {
  const temp = join(runtimeDir, "node.exe.baixando");
  mkdirSync(runtimeDir, { recursive: true });
  if (localExe) cpSync(localExe, temp);
  else {
    const response = await fetch(nodeUrl(node.version));
    if (!response.ok) throw new Error(`não consegui baixar o node.exe (${response.status})`);
    writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
  }
  try {
    if ((await sha256(temp)) !== node.sha256) throw new Error(MISMATCH);
    mkdirSync(join(runtimeDir, "node"), { recursive: true });
    cpSync(temp, join(runtimeDir, "node", "node.exe"));
  } finally {
    rmSync(temp, { force: true });
  }
  writeFileSync(join(runtimeDir, "runtime.json"), `${JSON.stringify({ node: node.version })}\n`);
}

const startsWithAny = (rel: string, prefixes: string[]): boolean => prefixes.some((prefix) => rel.startsWith(prefix));

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--target");
  const target = flag >= 0 ? (process.argv[flag + 1] ?? "") : "win32-x64";
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(target)) throw new Error("--target pede <plataforma>-<arquitetura>");

  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const repo = join(appDir, "..", "..");
  const stage = join(appDir, "release", "stage");
  const appOut = join(stage, "app");
  const runtimeOut = join(stage, "runtime");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(appOut, { recursive: true });

  const appManifest = join(appDir, "package.json");
  const app = JSON.parse(readFileSync(appManifest, "utf8")) as { version: string };
  const node = JSON.parse(readFileSync(join(appDir, "release", "node.json"), "utf8")) as { version: string; sha256: string };

  // App: o main.js em arquivo único, as telas e o koffi (módulo nativo, fica fora do arquivo).
  const optional = ["bufferutil", "utf-8-validate"];
  await bundle(join(appDir, "dist", "main.js"), join(appOut, "main.js"), ["electron", "koffi", ...optional]);
  cpSync(join(appDir, "dist", "preload.cjs"), join(appOut, "preload.cjs"));
  cpSync(join(repo, "packages", "client", "dist"), join(appOut, "client"), { recursive: true });
  const koffi = packageDir(appManifest, "koffi");
  const koffiVersion = (JSON.parse(readFileSync(join(koffi, "package.json"), "utf8")) as { version: string }).version;
  writeFileSync(join(appOut, "package.json"), `${JSON.stringify(stagedPackageJson(app, koffiVersion), null, 2)}\n`);
  const modules = join(appOut, "node_modules");
  // Do koffi só o que roda: sem a documentação, o código-fonte em C++ e as dependências de compilação.
  const koffiRuntime = (rel: string): boolean => !startsWithAny(rel, ["doc/", "vendor/", "lib/"]) && !/\.(cc|hh|inc)$|CMakeLists\.txt$/.test(rel);
  copyPackage(koffi, modules, "koffi", koffiRuntime);
  copyPackage(packageDir(join(koffi, "package.json"), `@koromix/koffi-${target}`), modules, `@koromix/koffi-${target}`);

  // Servidor: o better-sqlite3 só precisa do lib/ e do binário da plataforma (o node-addon-api é só de compilação).
  const serverOut = join(runtimeOut, "server");
  const serverManifest = join(repo, "packages", "server", "package.json");
  await bundle(join(repo, "packages", "server", "dist", "embedded.js"), join(serverOut, "embedded.js"), ["better-sqlite3", ...optional]);
  markAsModule(serverOut);
  const sqliteKeep = (rel: string): boolean => startsWithAny(rel, ["lib/"]) || ["package.json", "LICENSE", `prebuilds/${target}.node`].includes(rel);
  copyPackage(packageDir(serverManifest, "better-sqlite3"), join(serverOut, "node_modules"), "better-sqlite3", sqliteKeep);
  cpSync(join(repo, "assets", "map"), join(serverOut, "map"), { recursive: true });

  // Ponte: o node-pty carrega o pacote da plataforma pelo nome, então os dois ficam lado a lado.
  const bridgeOut = join(runtimeOut, "bridge");
  const bridgeManifest = join(repo, "packages", "bridge", "package.json");
  await bundle(join(repo, "packages", "bridge", "dist", "cli.js"), join(bridgeOut, "cli.js"), ["@lydell/node-pty"]);
  markAsModule(bridgeOut);
  const pty = packageDir(bridgeManifest, "@lydell/node-pty");
  copyPackage(pty, join(bridgeOut, "node_modules"), "@lydell/node-pty");
  copyPackage(packageDir(join(pty, "package.json"), `@lydell/node-pty-${target}`), join(bridgeOut, "node_modules"), `@lydell/node-pty-${target}`);

  // Node: o de WF_NODE_EXE (se existir) no lugar do download, conferido do mesmo jeito.
  const local = process.env.WF_NODE_EXE;
  await stageNode(node, runtimeOut, local && existsSync(local) ? local : undefined);
  console.log(`montado em ${stage} (${target}, Node ${node.version})`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
