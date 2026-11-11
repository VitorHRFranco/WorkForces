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
  log(m: string): void;
  firstMs?: number;
  everyMs?: number;
}

/**
 * Verifica os Releases 10 s depois de abrir e de 6 em 6 horas; baixa em segundo plano e avisa a versão baixada uma vez.
 * Falha (sem internet, proxy, sem Release) só vai ao log: o app não incomoda a pessoa por isso.
 */
export function startUpdates(deps: UpdateDeps): { downloaded(): string | null; stop(): void } {
  let downloaded: string | null = null;
  if (!deps.enabled) return { downloaded: () => null, stop: () => {} };

  const { updater, log } = deps;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-downloaded", (info) => {
    if (downloaded === info.version) return;
    downloaded = info.version;
    deps.notify(info.version);
  });
  updater.on("error", (error) => log(`atualização: ${error.message}`));

  const check = (): void => {
    // Um erro síncrono do atualizador também não pode derrubar o timer.
    try {
      updater.checkForUpdates().catch((error: unknown) => log(`atualização: ${error instanceof Error ? error.message : String(error)}`));
    } catch (error) {
      log(`atualização: ${error instanceof Error ? error.message : String(error)}`);
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
