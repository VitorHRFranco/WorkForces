import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Runtime, RuntimeSource } from "./layout.js";

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * No Windows, antivírus e indexador seguram por instantes a pasta recém-copiada (o node.exe, os `.node`): o rename tenta
 * de novo, com espera crescente, por até ~10 s no total.
 */
const MOVE_BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const MOVE_FIRST_WAIT_MS = 50;
const MOVE_MAX_WAIT_MS = 2_000;
const MOVE_TOTAL_MS = 10_000;

/** O que a cópia usa do disco para pôr a pasta montada no lugar, e a espera entre tentativas (os testes trocam). */
export interface InstallFs {
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  wait(ms: number): Promise<void>;
}

const realInstallFs: InstallFs = { rename, rm, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/**
 * Põe `tmp` no lugar de `final`. Devolve `false` se outra instância (outra sessão do mesmo usuário) terminou a mesma pasta
 * antes: completa, a dela vale.
 */
async function moveIntoPlace(tmp: string, final: string, complete: () => Promise<boolean>, fs: InstallFs): Promise<boolean> {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    // Conferido logo antes de apagar: uma pasta completa nunca sai do lugar.
    if (await complete()) return false;
    try {
      // Sobra incompleta de uma cópia interrompida: sai do caminho antes do rename.
      await fs.rm(final, { recursive: true, force: true });
      await fs.rename(tmp, final);
      return true;
    } catch (error) {
      const busy = MOVE_BUSY.has((error as NodeJS.ErrnoException).code ?? "");
      if (!busy || waited >= MOVE_TOTAL_MS) {
        if (await complete()) return false;
        throw error;
      }
      const ms = Math.min(MOVE_FIRST_WAIT_MS * 2 ** attempt, MOVE_MAX_WAIT_MS, MOVE_TOTAL_MS - waited);
      await fs.wait(ms);
      waited += ms;
    }
  }
}

/** Monta a pasta em `<nome>.tmp-<pid>` e só no fim renomeia: quem vê o nome final vê a pasta inteira. */
async function assemble(final: string, build: (tmp: string) => Promise<void>, complete: () => Promise<boolean>, fs: InstallFs): Promise<void> {
  if (await complete()) return;
  const tmp = `${final}.tmp-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    await build(tmp);
    if (await moveIntoPlace(tmp, final, complete, fs)) return;
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  // A pasta da outra instância ficou no lugar; a cópia desta sobra (se ficar presa, a próxima limpeza tira).
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

/**
 * Copia o Node e o app (servidor e ponte) da instalação para `root`. O Node fica em `node-<versão>`, que várias versões
 * do app dividem; o app em `app-<versão>-<carimbo da montagem>`, para um instalador novo da mesma versão não reaproveitar
 * o servidor e a ponte do anterior. Pasta que já está completa não é copiada de novo.
 */
export async function ensureRuntime(source: RuntimeSource, root: string, appVersion: string, fs: InstallFs = realInstallFs): Promise<Runtime> {
  const nodeDir = join(root, `node-${source.nodeVersion}`);
  const appDir = join(root, `app-${appVersion}-${source.build}`);
  const node = join(nodeDir, "node.exe");
  const serverEntry = join(appDir, "server", "embedded.js");
  const mapFile = join(appDir, "server", "map", "office.tmj");
  const bridgeCli = join(appDir, "bridge", "cli.js");
  await mkdir(root, { recursive: true });
  await assemble(
    nodeDir,
    (tmp) => cp(source.node, join(tmp, "node.exe")),
    () => exists(node),
    fs,
  );
  await assemble(
    appDir,
    async (tmp) => {
      await cp(source.serverDir, join(tmp, "server"), { recursive: true });
      await cp(source.bridgeDir, join(tmp, "bridge"), { recursive: true });
    },
    async () => (await Promise.all([serverEntry, mapFile, bridgeCli].map(exists))).every(Boolean),
    fs,
  );
  return { root, node, serverEntry, mapFile, bridgeCli, keep: [basename(nodeDir), basename(appDir)] };
}

export interface CleanupFs {
  readdir(path: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  /** O processo ainda roda? O `.tmp-<pid>` de um processo vivo é uma cópia em andamento. */
  alive(pid: number): boolean;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: o processo existe, só não é deste usuário.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const realFs: CleanupFs = { readdir: (path) => readdir(path), rename, rm, alive: processAlive };

/** O que o runtime cria em `root`: `node-…` e `app-…`, e as sobras `.tmp-<pid>` e `.old-<pid>` deles. O resto não é dele. */
const RUNTIME_NAME = /^(node|app)-/;
const TMP_PID = /\.tmp-(\d+)$/;

/**
 * Apaga de `root` as pastas do runtime que não estão em `keep` (versões antigas e sobras de cópia). No Windows, renomear
 * uma pasta com um programa rodando dentro falha: é assim que a pasta em uso fica. Erros só vão ao log.
 */
export async function cleanupRuntimes(root: string, keep: string[], fs: CleanupFs = realFs): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    console.warn("não consegui listar o runtime para limpar", error);
    return;
  }
  for (const name of names) {
    if (keep.includes(name) || !RUNTIME_NAME.test(name)) continue;
    // Cópia em andamento de outra instância (que divide a pasta): só sai depois que o processo dela morrer.
    const copying = TMP_PID.exec(name);
    if (copying && fs.alive(Number(copying[1]))) continue;
    const path = join(root, name);
    try {
      // Já renomeada por uma limpeza que não terminou: apaga direto, sem somar outro sufixo.
      if (name.includes(".old-")) {
        await fs.rm(path, { recursive: true, force: true });
        continue;
      }
      const old = `${path}.old-${process.pid}`;
      await fs.rename(path, old);
      await fs.rm(old, { recursive: true, force: true });
    } catch (error) {
      console.warn("não consegui apagar", path, error);
    }
  }
}
