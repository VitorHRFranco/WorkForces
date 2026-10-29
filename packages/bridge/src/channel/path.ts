import { tmpdir } from "node:os";
import { join } from "node:path";

/** Todo canal de agente começa assim; o app lista a pasta dos canais e procura este prefixo. */
export const CHANNEL_PREFIX = "workforces-agent-";

/** 128 bits aleatórios em hexadecimal minúsculo: nada de separador de caminho nem `..`. */
const CHANNEL_ID = /^[0-9a-f]{32}$/;

export function isChannelId(id: string): boolean {
  return CHANNEL_ID.test(id);
}

/** Onde ficam os canais: os named pipes no Windows; nos outros, uma pasta só deste usuário. */
export function channelDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "\\\\.\\pipe\\";
  return join(tmpdir(), `workforces-${process.getuid?.() ?? "usuario"}`);
}

export function channelPath(id: string, platform: NodeJS.Platform = process.platform): string {
  if (!isChannelId(id)) throw new Error(`id de canal inválido: ${id}`);
  const name = CHANNEL_PREFIX + id;
  return platform === "win32" ? channelDir(platform) + name : join(channelDir(platform), name);
}
