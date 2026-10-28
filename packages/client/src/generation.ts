let generation = 0;
const listeners = new Set<() => void>();

/** Cada rota entregue pelo processo principal sobe a geração: a tela da rota é refeita do zero. */
export function bumpGeneration(): void {
  generation++;
  for (const listener of [...listeners]) listener();
}

export function currentGeneration(): number {
  return generation;
}

export function onGeneration(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
