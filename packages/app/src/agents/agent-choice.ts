/** Um agente aberto neste computador (canal vivo), com a pasta do registro (null: registro antigo, sem pasta). */
export interface OpenAgent {
  agentId: string;
  label: string;
  folder: string | null;
}

/** `agentId` null: gerar um novo. `resume`: abrir o `claude` com `--continue`. */
export interface AgentChoice {
  label: string;
  agentId: string | null;
  resume: boolean;
}

/** O nome do n-ésimo agente de uma pasta: o primeiro é o próprio apelido; os seguintes, "teste 2", "teste 3"… */
export function labelFor(alias: string, n: number): string {
  return n === 1 ? alias : `${alias} ${n}`;
}

/**
 * O que uma chamada de "Chamar agente" abre na pasta `folder`:
 * - o nome é o menor livre entre os agentes abertos da pasta;
 * - a identidade é a do agente fechado guardado com esse nome (`remembered`), se nenhum agente aberto a usa;
 * - sem nenhum agente aberto na pasta, volta à última conversa dela (`--continue`); com um aberto, conversa nova.
 */
export function chooseAgent(alias: string, folder: string, open: readonly OpenAgent[], remembered: (label: string) => string | null): AgentChoice {
  const inFolder = open.filter((agent) => agent.folder === folder);
  const taken = new Set(inFolder.map((agent) => agent.label));
  let n = 1;
  while (taken.has(labelFor(alias, n))) n++;
  const label = labelFor(alias, n);
  const kept = remembered(label);
  const agentId = kept !== null && !open.some((agent) => agent.agentId === kept) ? kept : null;
  return { label, agentId, resume: inFolder.length === 0 };
}
