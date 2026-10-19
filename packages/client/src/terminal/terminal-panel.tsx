import type { AgentInfo, FrameBody } from "@workforces/protocol";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "preact/hooks";
import { applyFrame, type FrameState } from "./apply-frame";

export interface TerminalHandle {
  readonly agentId: string;
  apply(frame: FrameBody): "ok" | "gap" | "waiting";
}

const CHAR_WIDTH_RATIO = 0.6;

const LINE_HEIGHT_RATIO = 1.2;

function fontSizeFor(width: number, height: number, cols: number, rows: number): number {
  return Math.max(8, Math.min(16, Math.floor(width / (cols * CHAR_WIDTH_RATIO)), Math.floor(height / (rows * LINE_HEIGHT_RATIO))));
}

export function statusText(agent: AgentInfo): string {
  if (!agent.connected) return "reconectando…";
  return agent.status === "working" ? "trabalhando" : "parado";
}

export function TerminalPanel({
  agent,
  handle,
  onReady,
}: {
  agent: AgentInfo;
  handle: { current: TerminalHandle | null };
  /** Chamado quando o terminal já pode receber quadros: a página pede a tela inteira. */
  onReady: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current!;
    // Só leitura: o visitante nunca digita no agente de outra pessoa.
    const term = new Terminal({ disableStdin: true, cursorBlink: false, scrollback: 0, allowProposedApi: true, fontSize: 14 });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(element);
    // Só leitura de verdade: o terminal nunca fica com o foco (senão as teclas deixam de ir para o jogo).
    const textarea = term.textarea;
    if (textarea) {
      textarea.tabIndex = -1;
      textarea.addEventListener("focus", () => textarea.blur());
    }
    let cols = 80;
    let rows = 24;
    const fit = () => {
      term.options.fontSize = fontSizeFor(element.clientWidth, element.clientHeight, cols, rows);
    };
    // A fonte acompanha a largura do painel, não só os quadros-chave.
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    const state: FrameState = { lastSeq: null, lastResyncAt: Date.now() };
    handle.current = {
      agentId: agent.id,
      apply: (frame) => {
        if (frame.key && (frame.cols !== cols || frame.rows !== rows)) {
          cols = frame.cols;
          rows = frame.rows;
          fit();
        }
        return applyFrame(term, frame, state);
      },
    };
    onReady();
    return () => {
      resize.disconnect();
      if (handle.current?.agentId === agent.id) handle.current = null;
      term.dispose();
    };
  }, [agent.id]);

  return (
    <section class="panel">
      <header>
        <strong>{agent.label}</strong>
        <span>{agent.ownerName}</span>
        <span class="muted">{statusText(agent)}</span>
        {agent.ownerAway && <span class="muted">dono fora</span>}
      </header>
      <div class="terminal-host" ref={container} />
    </section>
  );
}
