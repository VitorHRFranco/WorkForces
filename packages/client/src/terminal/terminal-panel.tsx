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

function fontSizeFor(width: number, cols: number): number {
  return Math.max(8, Math.min(16, Math.floor(width / (cols * CHAR_WIDTH_RATIO))));
}

export function statusText(agent: AgentInfo): string {
  if (!agent.connected) return "reconectando…";
  return agent.status === "working" ? "trabalhando" : "parado";
}

export function TerminalPanel({
  agent,
  handle,
  onReady,
  onClose,
}: {
  agent: AgentInfo;
  handle: { current: TerminalHandle | null };
  /** Chamado quando o terminal já pode receber quadros: a página pede a tela inteira. */
  onReady: () => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current!;
    // Só leitura: o visitante nunca digita no agente de outra pessoa.
    const term = new Terminal({ disableStdin: true, cursorBlink: false, scrollback: 0, allowProposedApi: true, fontSize: 14 });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(element);
    const state: FrameState = { lastSeq: null, lastResyncAt: Date.now() };
    handle.current = {
      agentId: agent.id,
      apply: (frame) => {
        if (frame.key) term.options.fontSize = fontSizeFor(element.clientWidth, frame.cols);
        return applyFrame(term, frame, state);
      },
    };
    onReady();
    return () => {
      handle.current = null;
      term.dispose();
    };
  }, [agent.id]);

  return (
    <section class="panel">
      <header>
        <strong>{agent.label}</strong>
        <span>{agent.ownerName}</span>
        <span class="muted">{statusText(agent)}</span>
        <span class="readonly">somente leitura</span>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </header>
      <div class="terminal-host" ref={container} />
    </section>
  );
}
