import type { SpawnError } from "@workforces/protocol";

const TEXT: Record<SpawnError, string> = {
  "no-listener": "a ponte não está ligada: rode workforces ponte no seu computador",
  "unknown-alias": "essa pasta não está mais liberada na sua ponte",
  "folder-missing": "a pasta não existe mais no seu computador",
  "rate-limited": "espere alguns segundos entre um pedido e outro",
  "too-many-agents": "já há 5 agentes abertos no seu computador",
  "no-terminal": "o Windows Terminal não está instalado no seu computador",
  "spawn-failed": "não consegui abrir a janela (veja o terminal da ponte)",
  unsupported: "abrir agente pelo escritório só funciona no Windows por enquanto",
  timeout: "a ponte não respondeu a tempo",
};

/** O motivo da recusa, para quem pediu o agente. */
export function spawnErrorText(error: SpawnError): string {
  return TEXT[error];
}
