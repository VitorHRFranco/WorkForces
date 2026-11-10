import { isIPv4 } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { upnpNat, type Gateway, type UPnPNAT } from "@achingbrain/nat-port-mapper";

/** Quanto a busca do roteador por UPnP espera antes de desistir. */
const SEARCH_MS = 5_000;
/** Cada pedido ao roteador (abrir, desfazer, IP público) tem prazo: um roteador mudo não segura o "ligando…". */
const ANSWER_MS = 10_000;
/** Desfazer a porta não segura o desligar nem a saída do app por mais que isto. */
const STOP_MS = 3_000;

export type MapResult = { ok: true; externalIp: string | null } | { ok: false; reason: "no-gateway" | "refused" | "port-taken" };

/** Abre a porta do escritório no roteador e a desfaz ao desligar. */
export interface PortMapper {
  open(port: number): Promise<MapResult>;
  close(): Promise<void>;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** O IPv4 como número de 32 bits; null se não for um IPv4. */
function ipNumber(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

/** Só um IP público recebe quem está na internet; o que não é IPv4 também não serve no convite. */
export function classifyIp(ip: string): "public" | "private" | "cgnat" {
  if (!isIPv4(ip)) return "private";
  const [a = 0, b = 0] = ip.split(".").map(Number);
  // 100.64.0.0/10: o provedor divide um IP público entre vários clientes (CGNAT).
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  const isPrivate = a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return isPrivate ? "private" : "public";
}

/** O IP deste computador na rede do roteador: é para ele que o roteador manda as conexões de fora. */
export function localAddressFor(gatewayHost: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
  const gateway = ipNumber(gatewayHost);
  if (gateway === null) return null;
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== "IPv4") continue;
      const address = ipNumber(info.address);
      const mask = ipNumber(info.netmask);
      // Sem máscara, o adaptador não diz em que rede está.
      if (address === null || mask === null || mask === 0) continue;
      if ((address & mask) === (gateway & mask)) return info.address;
    }
  }
  return null;
}

/** Um rótulo de nome: letras, números e hífen, sem hífen nas pontas. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** O endereço da internet que a pessoa digita: um IPv4 ou um nome com ponto (DDNS), sem esquema e sem porta. */
export function isWanAddress(text: string): boolean {
  if (/^[\d.]+$/.test(text)) return isIPv4(text);
  const labels = text.split(".");
  const last = labels[labels.length - 1] ?? "";
  return text.length <= 253 && labels.length >= 2 && labels.every((label) => LABEL.test(label)) && /[a-z]/i.test(last);
}

/** O UPnP IGD do roteador: abre a porta pedida no IP deste computador; a biblioteca renova enquanto o app roda. */
export function upnpPortMapper(
  deps: {
    nat?: () => Pick<UPnPNAT, "findGateways">;
    searchMs?: number;
    interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
    log?(m: string): void;
  } = {},
): PortMapper {
  const nat = deps.nat ?? (() => upnpNat({ description: "WorkForces", ttl: 3_600_000, autoRefresh: true }));
  const interfaces = deps.interfaces ?? (() => networkInterfaces());
  const log = (m: string): void => deps.log?.(m);
  /** O roteador achado na última abertura: o `close` desfaz o que ele abriu e solta o que a biblioteca segura. */
  let current: Gateway | null = null;

  /** O primeiro roteador IPv4 que responder à busca, ou null no prazo. */
  async function findGateway(): Promise<Gateway | null> {
    let found: Gateway | null = null;
    try {
      for await (const gateway of nat().findGateways({ signal: AbortSignal.timeout(deps.searchMs ?? SEARCH_MS) })) {
        if (gateway.family !== "IPv4") continue;
        found = gateway;
        break;
      }
    } catch (error) {
      // Um erro ao encerrar a busca não desfaz o roteador já achado.
      log(`não consegui procurar o roteador por UPnP (${errorText(error)})`);
    }
    return found;
  }

  async function close(): Promise<void> {
    const gateway = current;
    current = null;
    if (!gateway) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log(`o roteador não respondeu ao desfazer a porta em ${STOP_MS / 1000} s`);
        resolve();
      }, STOP_MS);
    });
    const stopping = Promise.resolve()
      .then(() => gateway.stop())
      .catch((error: unknown) => log(`não consegui desfazer a porta no roteador (${errorText(error)})`));
    try {
      await Promise.race([stopping, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function open(port: number): Promise<MapResult> {
    // Uma porta aberta antes (de outra ligada) é desfeita antes de pedir de novo.
    await close();
    const gateway = await findGateway();
    if (!gateway) return { ok: false, reason: "no-gateway" };
    current = gateway;
    const localIp = localAddressFor(gateway.host, interfaces());
    if (localIp === null) {
      log(`o roteador ${gateway.host} não está em nenhuma rede deste computador`);
      return { ok: false, reason: "no-gateway" };
    }
    const answer = () => ({ signal: AbortSignal.timeout(ANSWER_MS) });
    let externalPort: number;
    try {
      ({ externalPort } = await gateway.map(port, localIp, { protocol: "TCP", externalPort: port, ...answer() }));
    } catch (error) {
      log(`o roteador não abriu a porta ${port} (${errorText(error)})`);
      return { ok: false, reason: "refused" };
    }
    if (externalPort !== port) {
      // A porta pedida já é de outro aparelho e o roteador deu outra: o convite com a porta certa não chegaria aqui.
      try {
        await gateway.unmap(port, answer());
      } catch (error) {
        log(`não consegui desfazer a porta ${externalPort} no roteador (${errorText(error)})`);
      }
      return { ok: false, reason: "port-taken" };
    }
    try {
      const ip = await gateway.externalIp(answer());
      return { ok: true, externalIp: isIPv4(ip) ? ip : null };
    } catch (error) {
      log(`o roteador abriu a porta, mas não disse o IP público (${errorText(error)})`);
      return { ok: true, externalIp: null };
    }
  }

  return { open, close };
}
