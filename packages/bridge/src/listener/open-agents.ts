import { execFile } from "node:child_process";

/** Script fixo (nada vindo de fora): as linhas de comando dos processos node.exe, em JSON. */
const LIST_NODE_PROCESSES = `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object { $_.CommandLine } | ConvertTo-Json -Compress`;

/** Quantas linhas de comando são de um `workforces claude` desta instalação (o mesmo cli.js). */
export function countAgentCommandLines(json: string, cliPath: string): number {
  const text = json.trim();
  if (text === "") return 0;
  const parsed: unknown = JSON.parse(text);
  const lines = Array.isArray(parsed) ? parsed : [parsed];
  const needle = cliPath.toLowerCase();
  return lines.filter((line): line is string => typeof line === "string" && line.toLowerCase().includes(needle) && /\sclaude(\s|"|$)/.test(line))
    .length;
}

/**
 * Agentes abertos neste computador com esta instalação da ponte (pelo mapa ou à mão), pela lista de processos do Windows.
 * Rejeita se não conseguir contar: quem chama recusa o pedido.
 */
export function countOpenAgents(cliPath: string): Promise<number> {
  const encoded = Buffer.from(LIST_NODE_PROCESSES, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15_000 },
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
