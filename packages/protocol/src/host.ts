import { z } from "zod";

/** O que o servidor embutido (processo filho) conta ao app pelo canal IPC. */
export type EmbeddedToHost =
  | { type: "ready"; pin: string; anchor: string; adminInvite: string | null }
  | { type: "failed"; reason: "port-in-use" | "error"; message: string };

/** O que o app manda ao servidor embutido. */
export type HostToEmbedded = { type: "stop" };

/** As escolhas da pessoa ao criar o escritório. */
export const HostSettingsInput = z.object({
  mode: z.enum(["lan", "wan"]),
  port: z.number().int().min(1024).max(65535),
  lanAddress: z.string().min(1).max(64).nullable(),
  wanAddress: z.string().min(1).max(253).nullable(),
});
export type HostSettingsInput = z.infer<typeof HostSettingsInput>;
