import { isIPv4 } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { ANSWER_MS, findIgd, nodeUpnpTransport, SEARCH_MS, soap, soapValue, type IgdService, type UpnpTransport } from "./upnp.js";

/** Desfazer a porta não segura o desligar nem a saída do app por mais que isto. */
const STOP_MS = 3_000;
/** A concessão pedida ao roteador (s): se o app cair, a porta se fecha sozinha em até uma hora. */
const LEASE_S = 3_600;
/** Renova bem antes de a concessão vencer. */
const RENEW_MS = 30 * 60_000;
/** ConflictInMappingEntry: a porta já está redirecionada para outro aparelho. */
const CONFLICT = 718;
/** OnlyPermanentLeasesSupported: o roteador só aceita concessão sem prazo (0). */
const ONLY_PERMANENT = 725;

export type MapResult = { ok: true; externalIp: string | null } | { ok: false; reason: "no-gateway" | "refused" | "port-taken" };

/** Abre a porta do escritório no roteador e a desfaz ao desligar. */
export interface PortMapper {
  open(port: number): Promise<MapResult>;
  close(): Promise<void>;
}

/** O IPv4 como número de 32 bits; null se não for um IPv4. */
function ipNumber(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

/** Só um IP público recebe quem está na internet; o que não é IPv4 também não serve no convite. */
export function classifyIp(ip: string): "public" | "private" | "cgnat" {
  if (!isIPv4(ip)) return "private";
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  // 100.64.0.0/10: o provedor divide um IP público entre vários clientes (CGNAT); 192.0.0.0/24: o lado do cliente no DS-Lite.
  if ((a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0)) return "cgnat";
  const isPrivate =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // 198.18.0.0/15 (teste de rede) e 224.0.0.0/3 (multicast e reservado): ninguém de fora chega por eles.
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
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

/** O UPnP IGD (v1 ou v2) do roteador: abre a porta pedida no IP deste computador e a renova enquanto o app roda. */
export function upnpPortMapper(
  deps: {
    transport?: UpnpTransport;
    searchMs?: number;
    interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
    log?(m: string): void;
  } = {},
): PortMapper {
  const interfaces = deps.interfaces ?? (() => networkInterfaces());
  const log = (m: string): void => deps.log?.(m);
  const transport = deps.transport ?? nodeUpnpTransport(interfaces, log);
  /** A porta aberta: o `close` a desfaz no mesmo serviço e para a renovação. */
  let current: { service: IgdService; port: number; renew: ReturnType<typeof setInterval> | null } | null = null;

  const addPortMapping = (service: IgdService, port: number, localIp: string, lease: number) =>
    soap(
      transport,
      service,
      "AddPortMapping",
      [
        ["NewRemoteHost", ""],
        ["NewExternalPort", port],
        ["NewProtocol", "TCP"],
        ["NewInternalPort", port],
        ["NewInternalClient", localIp],
        ["NewEnabled", 1],
        ["NewPortMappingDescription", "WorkForces"],
        ["NewLeaseDuration", lease],
      ],
      AbortSignal.timeout(ANSWER_MS),
    );

  async function close(): Promise<void> {
    const open = current;
    current = null;
    if (!open) return;
    if (open.renew) clearInterval(open.renew);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log(`o roteador não respondeu ao desfazer a porta ${open.port} em ${STOP_MS / 1000} s`);
        resolve();
      }, STOP_MS);
    });
    const deleting = soap(
      transport,
      open.service,
      "DeletePortMapping",
      [
        ["NewRemoteHost", ""],
        ["NewExternalPort", open.port],
        ["NewProtocol", "TCP"],
      ],
      AbortSignal.timeout(STOP_MS),
    ).then((result) => {
      if (!result.ok) log(`não consegui desfazer a porta ${open.port} no roteador (${result.detail})`);
    });
    try {
      await Promise.race([deleting, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function open(port: number): Promise<MapResult> {
    // Uma porta aberta antes (de outra ligada) é desfeita antes de pedir de novo.
    await close();
    const service = await findIgd(transport, { searchMs: deps.searchMs ?? SEARCH_MS, isLocal: (host) => localAddressFor(host, interfaces()) !== null, log });
    if (!service) return { ok: false, reason: "no-gateway" };
    const localIp = localAddressFor(service.host, interfaces());
    if (localIp === null) return { ok: false, reason: "no-gateway" };
    let lease = LEASE_S;
    let added = await addPortMapping(service, port, localIp, lease);
    if (!added.ok && added.errorCode === ONLY_PERMANENT) {
      lease = 0;
      added = await addPortMapping(service, port, localIp, lease);
    }
    if (!added.ok) {
      // 718: o redirecionamento é de outro aparelho; não há nada nosso a desfazer.
      if (added.errorCode === CONFLICT) return { ok: false, reason: "port-taken" };
      log(`o roteador não abriu a porta ${port} (${added.detail})`);
      return { ok: false, reason: "refused" };
    }
    let renew: ReturnType<typeof setInterval> | null = null;
    if (lease > 0) {
      renew = setInterval(() => {
        void addPortMapping(service, port, localIp, lease).then((result) => {
          if (!result.ok) log(`não consegui renovar a porta ${port} no roteador (${result.detail})`);
        });
      }, RENEW_MS);
      // A renovação não segura o app aberto.
      renew.unref();
    }
    current = { service, port, renew };
    const answer = await soap(transport, service, "GetExternalIPAddress", [], AbortSignal.timeout(ANSWER_MS));
    if (!answer.ok) {
      log(`o roteador abriu a porta, mas não disse o IP público (${answer.detail})`);
      return { ok: true, externalIp: null };
    }
    const ip = soapValue(answer.text, "NewExternalIPAddress");
    return { ok: true, externalIp: ip !== null && isIPv4(ip) ? ip : null };
  }

  return { open, close };
}
