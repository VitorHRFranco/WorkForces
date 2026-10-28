import { INVITE_CODE_PATTERN } from "@workforces/protocol";

const NOT_AN_INVITE = "isso não parece um convite do WorkForces; cole o link que você recebeu";
const INVITE_WITHOUT_HTTPS = "o convite aponta para um endereço sem https; peça um link com https a quem administra o escritório";
const BAD_CODE = "o convite está incompleto; copie o link inteiro de novo";
const BAD_ADDRESS = "endereço inválido; use algo como https://escritorio.exemplo";
const ADDRESS_WITHOUT_HTTPS = "esse endereço usa http sem criptografia; use https";

/** http:// só vale para a própria máquina. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Origin = { origin: string } | { problem: "invalid" | "insecure" };

/** Origem de um endereço de servidor: http(s), sem usuário e senha, e http só em localhost. */
function originOf(text: string): Origin {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { problem: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { problem: "invalid" };
  if (url.username !== "" || url.password !== "") return { problem: "invalid" };
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) return { problem: "insecure" };
  return { origin: url.origin };
}

/** Lê um convite: o link do app (`workforces://invite?...`) ou o link https da página do convite. */
export function parseInviteLink(text: string): { server: string; code: string } | { error: string } {
  const input = text.trim();
  let server: string | null;
  let code: string | null;

  if (/^workforces:/i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return { error: NOT_AN_INVITE };
    }
    if (url.hostname.toLowerCase() !== "invite") return { error: NOT_AN_INVITE };
    server = url.searchParams.get("server");
    code = url.searchParams.get("code");
    if (server === null) return { error: NOT_AN_INVITE };
  } else if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return { error: NOT_AN_INVITE };
    }
    const match = /^\/invite\/([^/]+)$/.exec(url.pathname);
    if (!match) return { error: NOT_AN_INVITE };
    server = url.origin;
    code = match[1]!;
    // Usuário e senha na URL do convite: a origem sozinha não os carrega, então confere aqui.
    if (url.username !== "" || url.password !== "") return { error: NOT_AN_INVITE };
  } else {
    return { error: NOT_AN_INVITE };
  }

  const origin = originOf(server);
  if ("problem" in origin) return { error: origin.problem === "insecure" ? INVITE_WITHOUT_HTTPS : NOT_AN_INVITE };
  if (code === null || !INVITE_CODE_PATTERN.test(code)) return { error: BAD_CODE };
  return { server: origin.origin, code };
}

/** Endereço digitado em "Já tenho conta": `https://host[:porta]` ou só `host[:porta]` (vira https). */
export function parseOfficeAddress(text: string): { url: string } | { error: string } {
  const input = text.trim();
  // O esquema é decidido pelo texto: `localhost:4600` não pode virar o esquema `localhost:`.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const origin = originOf(withScheme);
  if ("problem" in origin) return { error: origin.problem === "insecure" ? ADDRESS_WITHOUT_HTTPS : BAD_ADDRESS };
  return { url: origin.origin };
}

/** O link do app entre os argumentos de linha de comando do Electron. */
export function findInviteArg(argv: readonly string[]): string | null {
  return argv.find((arg) => /^workforces:/i.test(arg)) ?? null;
}
