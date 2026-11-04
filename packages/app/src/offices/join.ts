import { fetchAnchor } from "../net/pinned.js";
import { parseInviteLink, type Invite } from "../links.js";

/** Lê o convite e, se ele leva um pino, busca a âncora do escritório e confere; o aviso diz o que fazer. */
export async function prepareInvite(
  link: string,
  fetchAnchorImpl: typeof fetchAnchor = fetchAnchor,
): Promise<{ ok: true; invite: Invite; anchor: string | null } | { ok: false; notice: string }> {
  const invite = parseInviteLink(link);
  if ("error" in invite) return { ok: false, notice: invite.error };
  if (invite.pin === null) return { ok: true, invite, anchor: null };
  const result = await fetchAnchorImpl(invite.server, invite.pin);
  if (result.ok) return { ok: true, invite, anchor: result.anchor };
  if (result.error === "mismatch") {
    return { ok: false, notice: "o certificado do escritório não confere com o do convite; peça um convite novo a quem administra o escritório" };
  }
  return { ok: false, notice: `não consegui falar com ${new URL(invite.server).host}; confira a rede (ou a VPN) e se o escritório está ligado` };
}
