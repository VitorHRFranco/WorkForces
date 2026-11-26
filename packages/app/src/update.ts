import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** O que o app usa do `autoUpdater` do electron-updater (o de verdade entra pelo main.ts; os testes usam um falso). */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  on(event: "update-downloaded", cb: (info: { version: string }) => void): unknown;
  on(event: "error", cb: (error: Error) => void): unknown;
}

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdateDeps {
  updater: Updater;
  enabled: boolean;
  notify(version: string): void;
  /** Sem nível é aviso; o começo e o fim de uma verificação que deu certo são rotina (`info`). */
  log(m: string, level?: "info"): void;
  firstMs?: number;
  everyMs?: number;
  /** `false`: só verifica, sem baixar nem instalar ao fechar (o E2E que vai aos Releases de verdade). */
  download?: boolean;
}

/**
 * Verifica os Releases 10 s depois de abrir e de 6 em 6 horas; baixa em segundo plano e avisa a versão baixada uma vez.
 * Falha (sem internet, proxy, sem Release) só vai ao log: o app não incomoda a pessoa por isso. O começo e o fim de cada
 * verificação também vão ao log (é por eles que o CI vê a verificação rodar no app instalado).
 */
export function startUpdates(deps: UpdateDeps): { downloaded(): string | null; stop(): void } {
  let downloaded: string | null = null;
  if (!deps.enabled) return { downloaded: () => null, stop: () => {} };

  const { updater, log } = deps;
  const download = deps.download ?? true;
  updater.autoDownload = download;
  updater.autoInstallOnAppQuit = download;
  updater.on("update-downloaded", (info) => {
    if (downloaded === info.version) return;
    downloaded = info.version;
    deps.notify(info.version);
  });
  updater.on("error", (error) => log(`atualização: ${error.message}`));

  const failed = (error: unknown): void => log(`atualização: verificação falhou: ${error instanceof Error ? error.message : String(error)}`);
  const check = (): void => {
    log("atualização: verificando os Releases", "info");
    // Um erro síncrono do atualizador também não pode derrubar o timer.
    try {
      updater.checkForUpdates().then(() => log("atualização: verificação terminou", "info"), failed);
    } catch (error) {
      failed(error);
    }
  };
  let interval: NodeJS.Timeout | null = null;
  const first = setTimeout(() => {
    check();
    interval = setInterval(check, deps.everyMs ?? CHECK_EVERY_MS);
    interval.unref();
  }, deps.firstMs ?? FIRST_CHECK_MS);
  first.unref();

  return {
    downloaded: () => downloaded,
    stop: () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}

/**
 * O endereço das atualizações trocado por `WF_UPDATE_URL` (o E2E serve uma versão nova de dentro do runner). Só vale http
 * no próprio computador: qualquer outro valor devolve `null`, e o app continua nos Releases do GitHub.
 */
export function updateFeed(env: NodeJS.ProcessEnv): { provider: "generic"; url: string } | null {
  const raw = env.WF_UPDATE_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) return null;
  if (url.username || url.password) return null;
  return { provider: "generic", url: raw };
}

export const RESTART_TIMEOUT_MS = 15_000;
let restartPending = false;

/**
 * Chama o `quitAndInstall` uma vez. O electron-updater não lança quando não consegue sair: se o processo continua vivo
 * depois do prazo, `onFailed` desfaz o "fechando" e a pessoa pode tentar de novo.
 */
export function restartToUpdate(deps: { quitAndInstall(): void; onFailed(): void; timeoutMs?: number }): void {
  if (restartPending) return;
  restartPending = true;
  const timer = setTimeout(() => {
    restartPending = false;
    deps.onFailed();
  }, deps.timeoutMs ?? RESTART_TIMEOUT_MS);
  timer.unref();
  try {
    deps.quitAndInstall();
  } catch {
    // O prazo trata como falha do mesmo jeito.
  }
}

const RESUME_MARK = "religar-escritorio";

/** Marca que o escritório deste computador estava ligado ao reiniciar para atualizar: a abertura seguinte o religa. */
export function writeResumeMark(dir: string): void {
  try {
    writeFileSync(join(dir, RESUME_MARK), "");
  } catch {
    // Sem a marca, o escritório só não religa sozinho.
  }
}

/** Apaga a marca antes de devolver: um erro ao religar não vira um laço. */
export function takeResumeMark(dir: string): boolean {
  const path = join(dir, RESUME_MARK);
  try {
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
