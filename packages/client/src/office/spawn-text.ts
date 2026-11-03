import type { SpawnError } from "@workforces/protocol";

const TEXT: Record<SpawnError, string> = {
  "no-office": "entre no escritório antes de chamar um agente",
  "office-down": "não consegui falar com o escritório; confira a internet ou a VPN",
  "unknown-alias": "essa pasta não está mais liberada; escolha de novo em Pastas",
  "folder-missing": "a pasta não existe mais neste computador; remova e libere de novo em Pastas",
  "rate-limited": "espere alguns segundos entre um pedido e outro",
  "too-many-agents": "já há 5 agentes abertos neste computador; feche um antes",
  "no-terminal": "instale o Windows Terminal (no Windows 10: winget install Microsoft.WindowsTerminal)",
  "no-node": "instale o Node.js 22 ou mais novo (nodejs.org) e tente de novo",
  "spawn-failed": "não consegui abrir a janela do agente; tente de novo",
  "no-answer": "a janela abriu, mas o agente não respondeu; feche a janela e tente de novo",
  unsupported: "chamar agente só funciona no Windows por enquanto",
};

/** O motivo da recusa, para quem pediu o agente. */
export function spawnErrorText(error: SpawnError): string {
  return TEXT[error];
}
