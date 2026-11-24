import type { Appearance } from "@workforces/protocol";

/** Quanto a entrada no escritório espera, no máximo, pela aparência chegar ao servidor. */
export const SEND_APPEARANCE_TIMEOUT_MS = 3_000;

export interface SendAppearanceDeps {
  /** A aparência guardada no perfil local (null se a pessoa nunca escolheu). */
  get(): Promise<Appearance | null>;
  /** Manda ao servidor (`PUT /api/me/appearance`). */
  put(appearance: Appearance): Promise<void>;
  log(message: string): void;
  timeoutMs?: number;
}

/**
 * Antes de abrir o socket, manda a aparência do perfil, se houver. Nunca lança e nunca segura a entrada além do prazo:
 * servidor antigo (404), aparência recusada (400), rede ou demora só vão ao log, e a pessoa entra com a que o servidor tiver.
 */
export async function sendProfileAppearance(deps: SendAppearanceDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"prazo">((resolve) => {
    timer = setTimeout(() => resolve("prazo"), deps.timeoutMs ?? SEND_APPEARANCE_TIMEOUT_MS);
  });
  const send = async (): Promise<"ok"> => {
    const appearance = await deps.get();
    if (appearance) await deps.put(appearance);
    return "ok";
  };
  try {
    const result = await Promise.race([send(), deadline]);
    if (result === "prazo") deps.log("aparência: o escritório demorou a responder; entrando sem esperar");
  } catch (error) {
    deps.log(`aparência: não consegui mandar ao escritório (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    clearTimeout(timer);
  }
}
