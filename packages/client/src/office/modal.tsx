import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** `locked`: no meio de algo que não pode ser largado (o salvar do Personalizar), o modal não fecha — nem pelo "Fechar", nem por Esc, nem pelo fundo. */
export function Modal({ title, onClose, children, locked = false }: { title: string; onClose: () => void; children: ComponentChildren; locked?: boolean }) {
  // Só fecha pelo fundo se o botão desceu e subiu no fundo: selecionar um token arrastando e soltar fora não fecha.
  const pressedOnBackdrop = useRef(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lockedRef.current) onClose();
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
        if (pressedOnBackdrop.current && event.target === event.currentTarget && !lockedRef.current) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      <div class="modal" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" disabled={locked} onClick={onClose}>
            Fechar
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
