export type SendKind = "move" | "chat" | "watch";

/** Mensagens por segundo do lado do navegador, abaixo dos limites do servidor (move 20, chat 5, watch 20). */
export const SEND_LIMITS: Record<SendKind, number> = { move: 12, chat: 4, watch: 10 };

/** Janela deslizante de 1 s por tipo: o que passar do limite é descartado aqui, antes de o servidor fechar com 4008. */
export class SendBudget {
  private readonly sent: Record<SendKind, number[]> = { move: [], chat: [], watch: [] };

  allow(kind: SendKind, now: number): boolean {
    const recent = this.sent[kind].filter((time) => now - time < 1_000);
    const ok = recent.length < SEND_LIMITS[kind];
    if (ok) recent.push(now);
    this.sent[kind] = recent;
    return ok;
  }
}
