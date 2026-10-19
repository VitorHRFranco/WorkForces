import type { AgentInfo } from "@workforces/protocol";

/** Qual agente da mesa assistir: o escolhido, se ainda estiver nela; senão o primeiro. null = mesa sem agentes. */
export function watchTarget(agents: readonly AgentInfo[], current: string | null): string | null {
  if (current !== null && agents.some((agent) => agent.id === current)) return current;
  return agents[0]?.id ?? null;
}
