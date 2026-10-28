// Agente de brinquedo do GIF do README, no lugar do Claude Code: repete uma sessão curta, linha a linha, num projeto de
// brinquedo. O token falso do .env aparece mascarado no escritório (é a ponte que mascara).
const ESC = String.fromCharCode(27);
const NEWLINE = String.fromCharCode(13, 10);
const CLEAR = `${ESC}[2J${ESC}[H`;
const paint = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;
const token = "ghp_" + "demonstracaodebrinquedo".padEnd(36, "0");

const SESSION = [
  paint("1;36", "● agente de brinquedo") + paint("90", " · projeto loja"),
  "",
  paint("1", "> ") + "adicionar o carrinho de compras",
  "",
  paint("90", "  lendo ") + "src/loja.ts",
  paint("90", "  lendo ") + "src/carrinho.ts",
  paint("33", "  editando ") + "src/carrinho.ts " + paint("32", "+24") + " " + paint("31", "-3"),
  paint("90", "  lendo ") + ".env",
  `  GITHUB_TOKEN=${token}`,
  paint("90", "  rodando ") + "pnpm test",
  paint("32", "  ✓ 12 testes passaram"),
  "",
  paint("1;32", "✓ pronto: carrinho com total e frete"),
];
const LINE_MS = 700;
// A tela pronta fica um bom tempo antes de recomeçar: a gravação termina com a sessão inteira, não com a tela limpa.
const PAUSE_MS = 15000;

let next = 0;
function tick() {
  if (next === 0) process.stdout.write(CLEAR);
  process.stdout.write(SESSION[next] + NEWLINE);
  next = (next + 1) % SESSION.length;
  setTimeout(tick, next === 0 ? PAUSE_MS : LINE_MS);
}
tick();
