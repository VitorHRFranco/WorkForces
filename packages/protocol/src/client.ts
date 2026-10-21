import { z } from "zod";
import { AgentState } from "./bridge.js";
import { LIMITS } from "./constants.js";
import { frameBoundsError, frameShape } from "./frame.js";
import { Alias, AliasList, ReqId, SpawnResult } from "./listener.js";
import { DESK_ID_PATTERN } from "./map.js";

export const AgentInfo = z.object({
  id: z.uuid(),
  ownerId: z.number().int().min(1),
  ownerName: z.string(),
  label: z.string().min(1).max(LIMITS.maxLabelLength),
  status: AgentState,
  connected: z.boolean(),
  ownerAway: z.boolean(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const Me = z.object({ id: z.number().int().min(1), name: z.string(), isAdmin: z.boolean() });
export type Me = z.infer<typeof Me>;

/** Mesa do mapa e quem é o dono (null = livre). */
export const DeskInfo = z.object({
  id: z.string().regex(DESK_ID_PATTERN),
  ownerId: z.number().int().min(1).nullable(),
  ownerName: z.string().nullable(),
});
export type DeskInfo = z.infer<typeof DeskInfo>;

/** Quem está conectado, com a mesa (null = sem mesa livre). */
export const WelcomeMe = Me.extend({ deskId: z.string().regex(DESK_ID_PATTERN).nullable() });
export type WelcomeMe = z.infer<typeof WelcomeMe>;

export const Direction = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof Direction>;

/** Posição em pixels do mapa (centro do avatar). O servidor limita aos limites do mapa. */
const position = { x: z.number(), y: z.number(), dir: Direction, moving: z.boolean() };

export const PlayerInfo = z.object({ id: z.number().int().min(1), name: z.string(), ...position });
export type PlayerInfo = z.infer<typeof PlayerInfo>;

export const Move = z.object({ type: z.literal("move"), ...position });
export type Move = z.infer<typeof Move>;

/** Caracteres que o chat recusa: controle (C0, DEL, C1), quebra de linha Unicode e controles bidi. */
export const CHAT_FORBIDDEN = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const LONE_SURROGATE = /\p{Cs}/u;
/** Algum caractere que aparece na tela: mensagem só de espaços ou de invisíveis (U+200B, U+3164, U+2800…) não vale. */
export const CHAT_VISIBLE = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800]/u;

/** Texto do chat: 1 a 1000 caracteres, sem espaços nas pontas nem caracteres de controle (é mostrado como texto puro). */
export const ChatText = z
  .string()
  .min(1)
  .max(LIMITS.maxChatLength)
  .refine((text) => text === text.trim(), "sem espaços nas pontas")
  .refine((text) => !CHAT_FORBIDDEN.test(text) && !LONE_SURROGATE.test(text), "sem caracteres de controle")
  .refine((text) => CHAT_VISIBLE.test(text), "precisa de algum caractere visível");

export const ChatSend = z.object({ type: z.literal("chat"), text: ChatText });

export const ChatEntry = z.object({
  id: z.number().int().min(1),
  fromId: z.number().int().min(1),
  name: z.string(),
  text: z.string(),
  at: z.number(),
});
export type ChatEntry = z.infer<typeof ChatEntry>;

export const ChatPosted = ChatEntry.extend({ type: z.literal("chat") });

/** Cliente → servidor. Não existe mensagem que leve entrada a um agente. */
export const Watch = z.object({ type: z.literal("watch"), agentId: z.uuid() });
export const Unwatch = z.object({ type: z.literal("unwatch") });
/** Pede à ponte do próprio dono para abrir um agente na pasta com esse apelido. */
export const SpawnAgent = z.object({ type: z.literal("spawnAgent"), reqId: ReqId, alias: Alias });
export const ClientToServer = z.discriminatedUnion("type", [Watch, Unwatch, Move, ChatSend]);
export type ClientToServer = z.infer<typeof ClientToServer>;

export const Welcome = z.object({
  type: z.literal("welcome"),
  protocol: z.number().int(),
  me: WelcomeMe,
  players: z.array(PlayerInfo),
  agents: z.array(AgentInfo),
  desks: z.array(DeskInfo),
  chat: z.array(ChatEntry),
});
export const AgentAdded = z.object({ type: z.literal("agentAdded"), agent: AgentInfo });
export const AgentUpdated = z.object({ type: z.literal("agentUpdated"), agent: AgentInfo });
export const AgentRemoved = z.object({ type: z.literal("agentRemoved"), agentId: z.uuid() });
export const ClientFrame = z.object({ type: z.literal("frame"), agentId: z.uuid(), ...frameShape }).superRefine((frame, ctx) => {
  const error = frameBoundsError(frame);
  if (error) ctx.addIssue({ code: "custom", message: error });
});
export const WatchEnded = z.object({ type: z.literal("watchEnded"), agentId: z.uuid(), reason: z.enum(["left-zone", "agent-gone"]) });

/** Servidor → cliente. */
export const DeskUpdated = z.object({ type: z.literal("deskUpdated"), desk: DeskInfo });
export const PlayerJoined = z.object({ type: z.literal("playerJoined"), player: PlayerInfo });
export const PlayerLeft = z.object({ type: z.literal("playerLeft"), playerId: z.number().int().min(1) });
export const PlayerMoved = z.object({ type: z.literal("playerMoved"), playerId: z.number().int().min(1), ...position });
/** Só para o dono: as pastas que as pontes dele anunciam e se alguma ponte está ligada. */
export const AliasesUpdate = z.object({ type: z.literal("aliases"), aliases: AliasList, listenerOnline: z.boolean() });

export const ServerToClient = z.discriminatedUnion("type", [Welcome, AgentAdded, AgentUpdated, AgentRemoved, ClientFrame, WatchEnded, DeskUpdated, PlayerJoined, PlayerLeft, PlayerMoved, ChatPosted, AliasesUpdate, SpawnResult]);
export type ServerToClient = z.infer<typeof ServerToClient>;
