import { useRef, useState } from "preact/hooks";

export function CopyField({ value }: { value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      input.current?.select(); // sem área de transferência (ex.: http fora de localhost): seleciona para Ctrl+C
    }
  };
  return (
    <div class="copy">
      <input ref={input} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy}>
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
