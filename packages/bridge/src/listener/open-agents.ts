import { execFile } from "node:child_process";

/**
 * Script fixo (nada vindo de fora): as linhas de comando dos processos node.exe, em JSON.
 * Com a saída redirecionada o PowerShell 5.1 escreve na página de código OEM; o prefixo força UTF-8, senão caminho com acento não casa.
 * O `Stop` faz o script sair com erro se o prefixo falhar (PowerShell restrito): a ponte recusa em vez de contar errado.
 */
const LIST_NODE_PROCESSES = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object { $_.CommandLine } | ConvertTo-Json -Compress`;

/** Quantas linhas de comando são de um `workforces claude` desta instalação (o mesmo cli.js). */
export function countAgentCommandLines(json: string, cliPath: string): number {
  // U+FFFD é sinal de decodificação errada: contar assim daria menos agentes que o real.
  if (json.includes("\uFFFD")) throw new Error("saída da lista de processos com caracteres inválidos");
  const text = json.trim();
  if (text === "") return 0;
  const parsed: unknown = JSON.parse(text);
  const lines = Array.isArray(parsed) ? parsed : [parsed];
  const needle = cliPath.toLowerCase();
  return lines.filter((line): line is string => typeof line === "string" && line.toLowerCase().includes(needle) && /\sclaude(\s|"|$)/.test(line))
    .length;
}

/** Quanto a contagem pode levar; sem conseguir contar, a ponte recusa. */
export const COUNT_TIMEOUT_MS = 15_000;

/**
 * Agentes abertos neste computador, pela lista de processos do Windows: os `workforces claude` cuja linha de comando tem o caminho deste cli.js
 * (todos os que a ponte abre). Agentes abertos por atalho, link ou caminho relativo podem não entrar na conta.
 * Rejeita se não conseguir contar: quem chama recusa o pedido.
 */
export function countOpenAgents(cliPath: string, timeoutMs: number = COUNT_TIMEOUT_MS): Promise<number> {
  const encoded = Buffer.from(LIST_NODE_PROCESSES, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(countAgentCommandLines(stdout, cliPath));
        } catch (parseError) {
          reject(parseError as Error);
        }
      },
    );
  });
}
