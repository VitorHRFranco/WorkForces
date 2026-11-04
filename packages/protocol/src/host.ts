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

/** O escritório deste computador: desligado, ligando, ligado ou desligando. */
export type HostState = "off" | "starting" | "on" | "stopping";

/** Um endereço deste computador que pode ir no convite. */
export interface HostAddressInfo {
  address: string;
  /** O nome da rede e o endereço, ex.: "Wi-Fi · 192.168.0.10". */
  label: string;
  kind: "lan" | "vpn";
}

export interface WanStatus {
  mapping: "mapped" | "no-gateway" | "refused" | "port-taken";
  externalIp: string | null;
  /** O IP que o roteador informa não é público (CGNAT ou dois roteadores em sequência). */
  notPublic: boolean;
  /** O IP deste computador na rede do roteador, para o passo a passo. */
  localIp: string | null;
}

/** O que a tela sabe do escritório deste computador (nunca o pino nem o convite de admin). */
export interface HostStatus {
  created: boolean;
  state: HostState;
  settings: HostSettingsInput | null;
  /** A origem que vai nos convites, ex.: https://192.168.0.10:4600. */
  inviteOrigin: string | null;
  addresses: HostAddressInfo[];
  /** O endereço dos convites mudou desde a última vez que o escritório ligou. */
  addressChanged: { from: string; to: string } | null;
  /** Na WAN, os convites levam o endereço da LAN por falta do da internet. */
  usingLanFallback: boolean;
  wan: WanStatus | null;
  error: string | null;
}

export type HostConfigResult = { ok: true; status: HostStatus } | { ok: false; error: string };
