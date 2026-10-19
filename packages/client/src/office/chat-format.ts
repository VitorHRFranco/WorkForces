import { CHAT_FORBIDDEN, LIMITS } from "@workforces/protocol";

// O que o servidor recusa (controle, separadores de linha, controles bidi) e surrogates soltos viram espaço.
const FORBIDDEN = new RegExp(CHAT_FORBIDDEN.source, "g");
const LONE_SURROGATE = /\p{Cs}/gu;

/** O texto que vai para o servidor: o que ele recusa vira espaço, sem espaços nas pontas, até 1000 caracteres. null = nada a mandar. */
export function chatDraft(text: string): string | null {
  const clean = text
    .replace(FORBIDDEN, " ")
    .replace(LONE_SURROGATE, " ")
    .trim()
    .slice(0, LIMITS.maxChatLength)
    .replace(LONE_SURROGATE, " ") // o corte pode partir um par de surrogates ao meio
    .trim();
  return clean === "" ? null : clean;
}

export function formatChatTime(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
