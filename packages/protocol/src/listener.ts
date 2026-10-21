import { z } from "zod";

/** Apelido de pasta liberada (spec 5.2). O servidor só conhece apelidos, nunca caminhos. */
export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Quantas pastas uma ponte anuncia (e quantas o dono vê em "Chamar agente"). */
export const MAX_ALIASES = 50;
/** Id do pedido de abrir agente: o navegador gera, e o servidor só o usa para devolver a resposta a quem pediu. */
export const REQ_ID_PATTERN = /^[A-Za-z0-9-]{1,40}$/;

export const Alias = z.string().regex(ALIAS_PATTERN);
export const AliasList = z
  .array(Alias)
  .max(MAX_ALIASES)
  .refine((aliases) => new Set(aliases).size === aliases.length, "apelido repetido");
export const ReqId = z.string().regex(REQ_ID_PATTERN);

/** Por que o pedido de abrir agente falhou (o navegador mostra o texto em português). */
export const SpawnError = z.enum([
  "no-listener",
  "unknown-alias",
  "folder-missing",
  "rate-limited",
  "too-many-agents",
  "no-terminal",
  "spawn-failed",
  "unsupported",
  "timeout",
]);
export type SpawnError = z.infer<typeof SpawnError>;

/** Resultado do pedido: da ponte para o servidor e do servidor para o navegador, no mesmo formato. */
export const SpawnResult = z
  .object({ type: z.literal("spawnResult"), reqId: ReqId, ok: z.boolean(), error: SpawnError.optional() })
  .refine((result) => result.ok === (result.error === undefined), "error acompanha só ok: false");
export type SpawnResult = z.infer<typeof SpawnResult>;

/** Ouvinte (`workforces ponte`) → servidor. */
export const ListenerHello = z.object({
  type: z.literal("hello"),
  protocol: z.number().int(),
  kind: z.literal("listener"),
  aliases: AliasList,
});
export type ListenerHello = z.infer<typeof ListenerHello>;
export const ListenerAliases = z.object({ type: z.literal("aliases"), aliases: AliasList });
export const ListenerToServer = z.discriminatedUnion("type", [ListenerHello, ListenerAliases, SpawnResult]);
export type ListenerToServer = z.infer<typeof ListenerToServer>;

/** Servidor → ouvinte: a única mensagem nessa direção. Leva só o apelido, nunca caminho nem comando (regra 1). */
export const Spawn = z.object({ type: z.literal("spawn"), reqId: ReqId, alias: Alias });
export const ServerToListener = Spawn;
export type ServerToListener = z.infer<typeof Spawn>;
