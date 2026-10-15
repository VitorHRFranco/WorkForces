import unicode11 from "@xterm/addon-unicode11";
import xtermHeadless from "@xterm/headless";
import type { Terminal } from "@xterm/headless";

// Pacotes CommonJS: só o default import funciona no ESM do Node.
const { Terminal: HeadlessTerminal } = xtermHeadless;
const { Unicode11Addon } = unicode11;

/** Histórico existe só para o mascaramento olhar acima da tela; nunca é enviado. */
export const SCROLLBACK_LINES = 100;

export interface Headless {
  readonly term: Terminal;
  isCursorVisible(): boolean;
  write(data: string): void;
  /** Resolve quando tudo o que foi escrito até agora já foi interpretado. */
  flush(): Promise<void>;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

export function createHeadless(cols: number, rows: number): Headless {
  const term = new HeadlessTerminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";

  let cursorVisible = true;
  const trackCursor =
    (visible: boolean) =>
    (params: (number | number[])[]): boolean => {
      if (params.includes(25)) cursorVisible = visible;
      return false; // deixa o xterm tratar a sequência normalmente
    };
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, trackCursor(true));
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, trackCursor(false));

  return {
    term,
    isCursorVisible: () => cursorVisible,
    write: (data) => term.write(data),
    flush: () => new Promise<void>((resolve) => term.write("", resolve)),
    resize: (newCols, newRows) => term.resize(newCols, newRows),
    dispose: () => term.dispose(),
  };
}
