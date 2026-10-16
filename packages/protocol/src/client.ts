import { z } from "zod";
import { AgentState } from "./bridge.js";
import { LIMITS } from "./constants.js";
import { frameBoundsError, frameShape } from "./frame.js";

export const AgentInfo = z.object({
  id: z.uuid(),
  ownerId: z.number().int().min(1),
  ownerName: z.string(),
  label: z.string().min(1).max(LIMITS.maxLabelLength),
  status: AgentState,
  connected: z.boolean(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const Me = z.object({ id: z.number().int().min(1), name: z.string(), isAdmin: z.boolean() });
export type Me = z.infer<typeof Me>;

/** Cliente → servidor. Não existe mensagem que leve entrada a um agente. */
export const Watch = z.object({ type: z.literal("watch"), agentId: z.uuid() });
export const Unwatch = z.object({ type: z.literal("unwatch") });
export const ClientToServer = z.discriminatedUnion("type", [Watch, Unwatch]);
export type ClientToServer = z.infer<typeof ClientToServer>;

export const Welcome = z.object({ type: z.literal("welcome"), protocol: z.number().int(), me: Me, agents: z.array(AgentInfo) });
export const AgentAdded = z.object({ type: z.literal("agentAdded"), agent: AgentInfo });
export const AgentUpdated = z.object({ type: z.literal("agentUpdated"), agent: AgentInfo });
export const AgentRemoved = z.object({ type: z.literal("agentRemoved"), agentId: z.uuid() });
export const ClientFrame = z.object({ type: z.literal("frame"), agentId: z.uuid(), ...frameShape }).superRefine((frame, ctx) => {
  const error = frameBoundsError(frame);
  if (error) ctx.addIssue({ code: "custom", message: error });
});
export const WatchEnded = z.object({ type: z.literal("watchEnded"), agentId: z.uuid(), reason: z.enum(["agent-gone"]) });

/** Servidor → cliente. */
export const ServerToClient = z.discriminatedUnion("type", [Welcome, AgentAdded, AgentUpdated, AgentRemoved, ClientFrame, WatchEnded]);
export type ServerToClient = z.infer<typeof ServerToClient>;
