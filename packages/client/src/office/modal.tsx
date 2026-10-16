import type { ComponentChildren } from "preact";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
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
