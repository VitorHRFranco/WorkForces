// Agente de brinquedo dos testes E2E, no lugar do Claude Code: imprime uma sessão curta com um token falso, que a ponte
// precisa mascarar antes de mandar a tela ao escritório, e fica rodando até a ponte fechar.
const ESC = String.fromCharCode(27);
const NEWLINE = String.fromCharCode(13, 10);
const paint = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;
// Mesmo valor de FAKE_TOKEN em office.ts: ghp_ + 36 letras e números, como um token do GitHub.
const token = "ghp_" + "E2Etokendebrinquedo".padEnd(36, "0");

process.stdout.write(paint("1;36", "● agente de brinquedo") + NEWLINE);
process.stdout.write("lendo src/loja.ts" + NEWLINE);
process.stdout.write(`token de teste: ${token}` + NEWLINE);
process.stdout.write(paint("32", "pronto") + NEWLINE);
setInterval(() => {}, 60_000);
