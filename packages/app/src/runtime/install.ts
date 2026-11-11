import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Runtime, RuntimeSource } from "./layout.js";

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Monta a pasta em `<nome>.tmp-<pid>` e só no fim renomeia: quem vê o nome final vê a pasta inteira. */
async function assemble(final: string, build: (tmp: string) => Promise<void>, complete: () => Promise<boolean>): Promise<void> {
  if (await complete()) return;
  const tmp = `${final}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    await build(tmp);
    // Sobra incompleta de uma cópia interrompida: sai do caminho antes do rename.
    await rm(final, { recursive: true, force: true });
    await rename(tmp, final);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Copia o Node e o app (servidor e ponte) da instalação para `root`. O Node fica em `node-<versão>`, que várias versões
 * do app dividem; o app em `app-<versão>`. Pasta que já está completa não é copiada de novo.
 */
export async function ensureRuntime(source: RuntimeSource, root: string, appVersion: string): Promise<Runtime> {
  const nodeDir = join(root, `node-${source.nodeVersion}`);
  const appDir = join(root, `app-${appVersion}`);
  const node = join(nodeDir, "node.exe");
  const serverEntry = join(appDir, "server", "embedded.js");
  const mapFile = join(appDir, "server", "map", "office.tmj");
  const bridgeCli = join(appDir, "bridge", "cli.js");
  await mkdir(root, { recursive: true });
  await assemble(
    nodeDir,
    (tmp) => cp(source.node, join(tmp, "node.exe")),
    () => exists(node),
  );
  await assemble(
    appDir,
    async (tmp) => {
      await cp(source.serverDir, join(tmp, "server"), { recursive: true });
      await cp(source.bridgeDir, join(tmp, "bridge"), { recursive: true });
    },
    async () => (await Promise.all([serverEntry, mapFile, bridgeCli].map(exists))).every(Boolean),
  );
  return { root, node, serverEntry, mapFile, bridgeCli };
}

export interface CleanupFs {
  readdir(path: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

const realFs: CleanupFs = { readdir: (path) => readdir(path), rename, rm };

/**
 * Apaga de `root` o que não está em `keep` (versões antigas e sobras de cópia). No Windows, renomear uma pasta com um
 * programa rodando dentro falha: é assim que a pasta em uso fica. Erros só vão ao log.
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
    if (keep.includes(name)) continue;
    const path = join(root, name);
    try {
      const old = `${path}.old-${process.pid}`;
      await fs.rename(path, old);
      await fs.rm(old, { recursive: true, force: true });
    } catch (error) {
      console.warn("não consegui apagar", path, error);
    }
  }
}
