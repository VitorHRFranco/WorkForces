import { z } from "zod";
import { LIMITS } from "./constants.js";
import { frameBoundsError, frameShape } from "./frame.js";

export const AgentState = z.enum(["working", "idle"]);
export type AgentState = z.infer<typeof AgentState>;

export const AgentHello = z.object({
  type: z.literal("hello"),
  protocol: z.number().int(),
  kind: z.literal("agent"),
  agentId: z.uuid(),
  label: z.string().min(1).max(LIMITS.maxLabelLength),
  cols: frameShape.cols,
  rows: frameShape.rows,
});
export type AgentHello = z.infer<typeof AgentHello>;

export const AgentFrame = z.object({ type: z.literal("frame"), ...frameShape }).superRefine((frame, ctx) => {
  const error = frameBoundsError(frame);
  if (error) ctx.addIssue({ code: "custom", message: error });
});
export type AgentFrame = z.infer<typeof AgentFrame>;

export const AgentStatus = z.object({ type: z.literal("status"), state: AgentState });
export type AgentStatus = z.infer<typeof AgentStatus>;

/** Primeira mensagem de qualquer conexão da ponte: só existe o hello de agente. */
export const BridgeHello = AgentHello;
export type BridgeHello = AgentHello;

/** Tudo o que a conexão de um agente pode mandar ao servidor. */
export const AgentToServer = z.discriminatedUnion("type", [AgentHello, AgentFrame, AgentStatus]);
export type AgentToServer = z.infer<typeof AgentToServer>;

/** Única mensagem do servidor para um agente. Não existe mensagem de entrada para o PTY (regra 2). */
export const Viewers = z.object({ type: z.literal("viewers"), n: z.number().int().min(0) });
export type Viewers = z.infer<typeof Viewers>;

export const ServerToAgent = Viewers;
export type ServerToAgent = Viewers;
