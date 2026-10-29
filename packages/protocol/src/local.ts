import { z } from "zod";
import { AgentFrame, AgentState, AgentStatus } from "./bridge.js";
import { LIMITS } from "./constants.js";
import { frameShape } from "./frame.js";

/**
 * Canal local entre o app e o invólucro de um agente (named pipe no Windows, socket Unix nos outros):
 * uma mensagem JSON por linha. O invólucro não manda nada antes do `hello` do app.
 */
export const LOCAL_PROTOCOL_VERSION = 1;

/** Maior digitação do painel do app numa mensagem só. */
export const LOCAL_INPUT_MAX = 4096;

export const LocalHello = z.object({ type: z.literal("hello"), protocol: z.number().int() });
export type LocalHello = z.infer<typeof LocalHello>;

/** Credenciais do escritório: só chegam por aqui, nunca pela linha de comando nem por arquivo. */
export const LocalStart = z.object({
  type: z.literal("start"),
  server: z.string().min(1).max(2048),
  token: z.string().min(1).max(200),
  label: z.string().min(1).max(LIMITS.maxLabelLength),
  secretPatterns: z.array(z.string().max(500)).max(50),
});
export type LocalStart = z.infer<typeof LocalStart>;

/** O painel do app abriu (ou fechou) neste agente: só então saem quadros pelo canal. */
export const LocalWatch = z.object({ type: z.literal("watch") });
export type LocalWatch = z.infer<typeof LocalWatch>;

export const LocalUnwatch = z.object({ type: z.literal("unwatch") });
export type LocalUnwatch = z.infer<typeof LocalUnwatch>;

/** Digitação do dono no painel do app; é o único caminho, além do stdin local, até o PTY. */
export const LocalInput = z.object({ type: z.literal("input"), data: z.string().min(1).max(LOCAL_INPUT_MAX) });
export type LocalInput = z.infer<typeof LocalInput>;

export const AppToAgent = z.discriminatedUnion("type", [LocalHello, LocalStart, LocalWatch, LocalUnwatch, LocalInput]);
export type AppToAgent = z.infer<typeof AppToAgent>;

/** Resposta ao `hello` e a cada `start`; `label` e `office` ficam nulos até o `start`. */
export const LocalInfo = z.object({
  type: z.literal("info"),
  agentId: z.uuid(),
  label: z.string().max(LIMITS.maxLabelLength).nullable(),
  office: z.string().max(2048).nullable(),
  cols: frameShape.cols,
  rows: frameShape.rows,
  state: AgentState,
});
export type LocalInfo = z.infer<typeof LocalInfo>;

export const AgentToApp = z.discriminatedUnion("type", [LocalInfo, AgentFrame, AgentStatus]);
export type AgentToApp = z.infer<typeof AgentToApp>;
