/** Formato do código de convite (o servidor e o app conferem com o mesmo padrão). */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Esquema do link que abre o app do WorkForces. */
export const APP_LINK_SCHEME = "workforces";

/** Link que abre o app já no convite: `workforces://invite?server=<origem>&code=<código>`. */
export function inviteAppLink(origin: string, code: string): string {
  return `${APP_LINK_SCHEME}://invite?server=${encodeURIComponent(origin)}&code=${encodeURIComponent(code)}`;
}
