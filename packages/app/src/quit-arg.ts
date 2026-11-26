/**
 * `WorkForces.exe --quit`: o instalador e o desinstalador pedem assim ao app aberto que saia pelo caminho normal (desliga
 * o escritório deste computador e solta os canais dos agentes), antes de recorrer a encerrá-lo à força.
 */
export function wantsQuit(argv: readonly string[]): boolean {
  return argv.includes("--quit");
}
