/** SW_SHOWMINNOACTIVE: minimiza sem tirar o foco de quem está usando o computador. */
const SW_SHOWMINNOACTIVE = 7;
/** SW_RESTORE: desfaz o minimizar e mostra a janela no tamanho e lugar de antes. */
const SW_RESTORE = 9;
const POLL_MS = 200;
/** Quanto do título é lido; o da janela do agente é bem mais curto. */
const TITLE_CHARS = 512;

interface User32 {
  /** A primeira janela de primeiro nível cujo título contém `marker`, ou null. */
  find(marker: string): unknown;
  minimize(hwnd: unknown): void;
  restore(hwnd: unknown): void;
}

let loaded: Promise<User32> | null = null;

/** Declara as funções do `user32.dll` uma vez só: o koffi recusa um segundo tipo com o mesmo nome. */
function user32(): Promise<User32> {
  loaded ??= load();
  return loaded;
}

async function load(): Promise<User32> {
  const { default: koffi } = await import("koffi");
  const lib = koffi.load("user32.dll");
  koffi.pointer("HWND", koffi.opaque());
  // BOOL do Win32 é int; o LPARAM tem a largura de um ponteiro.
  const EnumWindowsProc = koffi.proto("int __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)");
  const EnumWindows = lib.func("int __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)");
  const GetWindowThreadProcessId = lib.func("uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *lpdwProcessId)");
  const GetWindowTextW = lib.func("int __stdcall GetWindowTextW(HWND hWnd, _Out_ uint16_t *lpString, int nMaxCount)");
  const ShowWindow = lib.func("int __stdcall ShowWindow(HWND hWnd, int nCmdShow)");
  const SetForegroundWindow = lib.func("int __stdcall SetForegroundWindow(HWND hWnd)");

  return {
    find(marker) {
      const title = Buffer.alloc(TITLE_CHARS * 2);
      const pid = new Uint32Array(1);
      let found: unknown = null;
      let failure: unknown = null;
      // O EnumWindows só chama de volta enquanto roda; o registro é desfeito logo depois.
      const callback = koffi.register((hwnd: unknown): number => {
        try {
          // Nas janelas do próprio processo o GetWindowTextW manda WM_GETTEXT e pode travar o processo principal do Electron.
          // As do agente são do Windows Terminal; para as de outro processo o título é lido sem mensagem.
          if ((GetWindowThreadProcessId(hwnd, pid) as number) === 0 || pid[0] === process.pid) return 1;
          const length = GetWindowTextW(hwnd, title, TITLE_CHARS) as number;
          if (length > 0 && title.toString("utf16le", 0, length * 2).includes(marker)) {
            found = hwnd;
            return 0; // achou: para de percorrer
          }
          return 1;
        } catch (error) {
          failure = error;
          return 0;
        }
      }, koffi.pointer(EnumWindowsProc));
      try {
        EnumWindows(callback, 0);
      } finally {
        koffi.unregister(callback);
      }
      if (failure !== null) throw failure;
      return found;
    },
    minimize(hwnd) {
      ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
    },
    restore(hwnd) {
      ShowWindow(hwnd, SW_RESTORE);
      // O Windows pode recusar trazer para a frente (outro programa com o foco): a janela já está restaurada, e basta.
      try {
        SetForegroundWindow(hwnd);
      } catch {
        // melhor esforço
      }
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Procura a janela pelo título a cada 200 ms até o prazo; null se não apareceu. */
async function findWindow(api: User32, marker: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hwnd = api.find(marker);
    if (hwnd !== null) return hwnd;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(POLL_MS, left));
  }
}

/**
 * Minimiza a janela do agente pelo título único (só Windows: o Windows Terminal não tem opção para abrir minimizado).
 * Procura a cada 200 ms até o prazo. É melhor esforço: qualquer erro vira `false` e a janela só fica aberta; nunca lança.
 */
export async function minimizeWindow(marker: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    // Título vazio casaria com qualquer janela.
    if (marker === "") return false;
    const api = await user32();
    const hwnd = await findWindow(api, marker, timeoutMs);
    if (hwnd === null) return false;
    api.minimize(hwnd);
    return true;
  } catch (error) {
    console.warn("não consegui minimizar a janela do agente; ela fica aberta", error);
    return false;
  }
}

/**
 * Restaura a janela do agente pelo título único e tenta trazê-la para a frente: quando o agente não responde, o motivo
 * (Claude não instalado, erro do invólucro) está escrito nela. Melhor esforço: qualquer erro vira `false`; nunca lança.
 */
export async function restoreWindow(marker: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    if (marker === "") return false;
    const api = await user32();
    const hwnd = await findWindow(api, marker, timeoutMs);
    if (hwnd === null) return false;
    api.restore(hwnd);
    return true;
  } catch (error) {
    console.warn("não consegui restaurar a janela do agente", error);
    return false;
  }
}
