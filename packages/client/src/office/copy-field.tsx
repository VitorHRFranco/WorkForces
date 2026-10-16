import { useRef, useState } from "preact/hooks";

export function CopyField({ value }: { value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("Copiar");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setLabel("Copiado");
    } catch {
      input.current?.select();
      setLabel("Selecionado: aperte Ctrl+C"); // sem área de transferência (ex.: http fora de localhost): seleciona para Ctrl+C
    }
  };
  return (
    <div class="copy">
      <input ref={input} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy}>
        {label}
      </button>
    </div>
  );
}
