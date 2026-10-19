import { z } from "zod";
import { AgentState } from "./bridge.js";
import { LIMITS } from "./constants.js";
import { frameBoundsError, frameShape } from "./frame.js";
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

/** Cliente → servidor. Não existe mensagem que leve entrada a um agente. */
export const Watch = z.object({ type: z.literal("watch"), agentId: z.uuid() });
export const Unwatch = z.object({ type: z.literal("unwatch") });
export const ClientToServer = z.discriminatedUnion("type", [Watch, Unwatch, Move]);
export type ClientToServer = z.infer<typeof ClientToServer>;

export const Welcome = z.object({
  type: z.literal("welcome"),
  protocol: z.number().int(),
  me: WelcomeMe,
  players: z.array(PlayerInfo),
  agents: z.array(AgentInfo),
  desks: z.array(DeskInfo),
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

export const ServerToClient = z.discriminatedUnion("type", [Welcome, AgentAdded, AgentUpdated, AgentRemoved, ClientFrame, WatchEnded, DeskUpdated, PlayerJoined, PlayerLeft, PlayerMoved]);
export type ServerToClient = z.infer<typeof ServerToClient>;
