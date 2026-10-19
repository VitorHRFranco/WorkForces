import { useEffect, useState } from "preact/hooks";

/** Campo de texto com foco: as teclas são de quem digita, não do jogo. */
export function isTypingTarget(element: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!element) return false;
  const tag = element.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}

/** true enquanto algum campo de texto da página (chat, modais) tem o foco. */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    // focusout acontece antes de o foco chegar ao próximo elemento: confere depois.
    const update = () => queueMicrotask(() => setTyping(isTypingTarget(document.activeElement as HTMLElement | null)));
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return typing;
}
