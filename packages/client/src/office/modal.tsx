import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  // Só fecha pelo fundo se o botão desceu e subiu no fundo: selecionar um token arrastando e soltar fora não fecha.
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      class="modal-backdrop"
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      <div class="modal" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
