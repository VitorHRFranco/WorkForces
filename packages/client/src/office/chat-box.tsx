import type { ChatEntry } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { isTypingTarget } from "../game/typing";
import { chatDraft, formatChatTime } from "./chat-format";

/** Chat do escritório (spec 8): Enter foca o campo, Esc devolve o foco ao jogo; texto puro, sem links. */
export function ChatBox({ messages, onSend }: { messages: ChatEntry[]; onSend: (text: string) => boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || isTypingTarget(document.activeElement as HTMLElement | null)) return;
      if (document.activeElement instanceof HTMLButtonElement) return; // Enter num botão focado aciona o botão
      if (document.querySelector(".modal")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // O OfficeState troca o array a cada mensagem; o tamanho para em 200.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const submit = (event: Event) => {
    event.preventDefault();
    const text = chatDraft(draft);
    if (!text) return;
    if (onSend(text)) {
      setDraft("");
      setWarning(null);
    } else {
      setWarning("Mensagem não enviada: espere um pouco (ou confira a conexão).");
    }
  };

  return (
    <section class="chat" aria-label="Chat">
      <ol class="chat-log" ref={log}>
        {messages.map((message) => (
          <li key={message.id}>
            <time>{formatChatTime(message.at)}</time>
            <strong>{message.name}</strong> {message.text}
          </li>
        ))}
      </ol>
      <form onSubmit={submit}>
        <input
          ref={input}
          value={draft}
          maxLength={1000}
          placeholder="Enter para conversar · Esc volta ao mapa"
          aria-label="Mensagem"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            // As teclas são do campo: o jogo (que escuta a janela) não as vê, nem para travar o espaço antes de o foco chegar a ele.
            event.stopPropagation();
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
      </form>
      {warning && (
        <p class="error" role="alert">
          {warning}
        </p>
      )}
    </section>
  );
}
