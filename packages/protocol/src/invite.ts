/** Formato do código de convite (o servidor e o app conferem com o mesmo padrão). */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Esquema do link que abre o app do WorkForces. */
export const APP_LINK_SCHEME = "workforces";

/** Pino do certificado: SHA-256 do certificado em base64url (43 caracteres). */
export const PIN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Link que abre o app já no convite: `workforces://invite?server=<origem>&code=<código>`, com `&pin=<pino>` na rede interna. */
export function inviteAppLink(origin: string, code: string, pin?: string | null): string {
  const link = `${APP_LINK_SCHEME}://invite?server=${encodeURIComponent(origin)}&code=${encodeURIComponent(code)}`;
  return pin ? `${link}&pin=${encodeURIComponent(pin)}` : link;
}
