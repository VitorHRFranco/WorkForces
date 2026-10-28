let flash: string | null = null;

/** Guarda um aviso para a próxima tela inicial. */
export function setFlash(text: string): void {
  flash = text;
}

/** Entrega o aviso guardado, uma vez só. */
export function takeFlash(): string | null {
  const text = flash;
  flash = null;
  return text;
}
