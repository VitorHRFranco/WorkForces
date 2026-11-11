import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A pasta de dados do app: a mesma de sempre; `WF_APP_DATA_DIR` (E2E, uma por instância) vence. */
export function userDataDir(env: NodeJS.ProcessEnv, appData: string): string {
  return env.WF_APP_DATA_DIR ? resolve(env.WF_APP_DATA_DIR) : join(appData, "@workforces", "app");
}

/** Onde o runtime (Node, servidor e ponte) é copiado: fora da pasta de instalação, que o atualizador troca. */
export function runtimeRootDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, userData: string): string {
  if (env.WF_RUNTIME_DIR) return resolve(env.WF_RUNTIME_DIR);
  if (platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "WorkForces", "runtime");
  return join(userData, "runtime");
}

/** De onde o runtime é copiado: a pasta `resources/runtime` do app instalado. */
export interface RuntimeSource {
  node: string;
  nodeVersion: string;
  /** O carimbo da montagem (12 hex): muda com qualquer arquivo do servidor ou da ponte, mesmo sem mudar a versão. */
  build: string;
  serverDir: string;
  bridgeDir: string;
}

export function packagedSource(resourcesPath: string): RuntimeSource {
  const dir = join(resourcesPath, "runtime");
  const info = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8")) as { node?: unknown; build?: unknown };
  if (typeof info.node !== "string" || !info.node) throw new Error("runtime.json sem a versão do Node");
  if (typeof info.build !== "string" || !/^[0-9a-f]{12}$/.test(info.build)) throw new Error("runtime.json sem o carimbo da montagem");
  return { node: join(dir, "node", "node.exe"), nodeVersion: info.node, build: info.build, serverDir: join(dir, "server"), bridgeDir: join(dir, "bridge") };
}

/** Os caminhos que o app usa para subir o servidor e o invólucro (já na cópia, nunca na instalação). */
export interface Runtime {
  root: string;
  node: string;
  serverEntry: string;
  mapFile: string;
  bridgeCli: string;
  /** As pastas de `root` em uso por este app (o Node e a app); a limpeza apaga as outras. */
  keep: string[];
}

/** As telas: empacotado, ao lado do `main.js`; em desenvolvimento, nos pacotes do repositório. */
export function pageFiles(packaged: boolean, mainUrl: string): { clientDir: string; preload: string } {
  return {
    clientDir: fileURLToPath(new URL(packaged ? "./client" : "../../client/dist", mainUrl)),
    preload: fileURLToPath(new URL("./preload.cjs", mainUrl)),
  };
}
