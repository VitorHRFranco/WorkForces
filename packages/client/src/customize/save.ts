import type { Appearance } from "@workforces/protocol";
import { ApiError } from "../api";

export type SaveResult = "saved" | "office-refused" | "office-unreachable" | "invalid";

export interface SaveDeps {
  setProfile(appearance: Appearance): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Manda ao escritório aberto; null fora de um escritório. */
  putOffice: ((appearance: Appearance) => Promise<void>) | null;
}

/** O que a tela mostra quando não deu tudo certo. */
export const SAVE_MESSAGES: Record<Exclude<SaveResult, "saved">, string> = {
  "office-refused": "Seu personagem foi salvo, mas este escritório não aceitou: ele está numa versão mais antiga do WorkForces. Os outros continuam vendo você como antes.",
  "office-unreachable": "Seu personagem foi salvo neste computador, mas não consegui avisar o escritório agora. Ele chega na próxima vez que você entrar.",
  invalid: "Não consegui salvar o personagem.",
};

/** Grava no perfil local e, dentro de um escritório, manda a ele. Nunca lança. */
export async function saveAppearance(appearance: Appearance, deps: SaveDeps): Promise<SaveResult> {
  try {
    const saved = await deps.setProfile(appearance);
    if (!saved.ok) return "invalid";
  } catch {
    return "invalid";
  }
  if (!deps.putOffice) return "saved";
  try {
    await deps.putOffice(appearance);
    return "saved";
  } catch (error) {
    return error instanceof ApiError && error.status === 400 ? "office-refused" : "office-unreachable";
  }
}
