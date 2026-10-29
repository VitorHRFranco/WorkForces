import { spawn } from "node:child_process";

/** Quanto a contagem pode levar; sem conseguir contar, o app recusa. */
export const COUNT_TIMEOUT_MS = 15_000;

/**
 * Script fixo (nada vindo de fora): o caminho do cli.js chega pela variável `WF_CLI` e a comparação acontece aqui dentro,
 * então só um número sai (sem acento, sem problema de página de código).
 * Falha fechada de forma explícita: qualquer erro cai no `catch`, que escreve no stderr e sai com código 1, sem nada no stdout.
 * (Com `-Command -`, o `$ErrorActionPreference = 'Stop'` sozinho não encerra o script nem muda o código de saída.)
 * O `try` fica numa linha só: com `-Command -`, um bloco de várias linhas sem linha em branco no fim não roda e não imprime nada.
 * Além disso, quem chama só aceita um stdout que seja só dígitos, com código de saída 0.
 */
export const COUNT_SCRIPT = `$ErrorActionPreference = 'Stop'
try { $cli = $env:WF_CLI.ToLowerInvariant(); $n = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($cli) -and $_.CommandLine -match '\\sclaude(\\s|"|$)' }).Count; [Console]::Out.Write($n) } catch { [Console]::Error.Write($_); exit 1 }
`;

export interface PowerShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Roda o script no PowerShell, pelo stdin. Rejeita no erro de início e no prazo estourado. */
export type PowerShellRunner = (script: string, cliPath: string, timeoutMs: number) => Promise<PowerShellResult>;

export const runPowerShell: PowerShellRunner = (script, cliPath, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      windowsHide: true,
      env: { ...process.env, WF_CLI: cliPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (action: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("a contagem de agentes passou do prazo")));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => resolve({ code, stdout, stderr })));
    // Um erro de pipe (o PowerShell fechou antes de ler) aparece no "close"/"error" do filho.
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });

/**
 * Agentes abertos neste computador, pela lista de processos do Windows: os `workforces claude` cuja linha de comando tem o caminho deste cli.js.
 * Rejeita se não conseguir contar: quem chama recusa o pedido.
 */
export async function countOpenAgents(cliPath: string, timeoutMs: number = COUNT_TIMEOUT_MS, run: PowerShellRunner = runPowerShell): Promise<number> {
  const { code, stdout, stderr } = await run(COUNT_SCRIPT, cliPath, timeoutMs);
  if (code !== 0) throw new Error(`o PowerShell saiu com código ${code}: ${stderr.trim().slice(0, 200)}`);
  const text = stdout.trim();
  if (!/^\d+$/.test(text)) throw new Error("a contagem de agentes não devolveu um número");
  return Number(text);
}
