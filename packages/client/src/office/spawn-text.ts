import type { SpawnError } from "@workforces/protocol";

const TEXT: Record<SpawnError, string> = {
  "no-office": "entre no escritório antes de chamar um agente",
  "office-down": "não consegui falar com o escritório; confira a internet ou a VPN",
  "unknown-alias": "essa pasta não está mais liberada; escolha de novo em Pastas",
  "folder-missing": "a pasta não existe mais neste computador; remova e libere de novo em Pastas",
  "rate-limited": "espere alguns segundos entre um pedido e outro",
  "too-many-agents": "já há 5 agentes abertos neste computador; feche um antes",
  "no-terminal": "instale o Windows Terminal (no Windows 10: winget install Microsoft.WindowsTerminal)",
  "no-node": "instale o Node.js 22.12 ou mais novo (nodejs.org); depois saia pelo ícone da bandeja (Sair) e abra o app de novo",
  "spawn-failed": "não consegui abrir a janela do agente; tente de novo",
  "no-answer": "o agente não respondeu; veja o motivo na janela dele, que acabou de abrir na tela",
  unsupported: "chamar agente só funciona no Windows por enquanto",
};

/** O motivo da recusa, para quem pediu o agente. */
export function spawnErrorText(error: SpawnError): string {
  return TEXT[error];
}
