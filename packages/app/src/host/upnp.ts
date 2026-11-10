import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/** Quanto a busca do roteador espera antes de desistir. */
export const SEARCH_MS = 5_000;
/** Cada pedido ao roteador tem prazo: um roteador mudo não segura o "ligando…" (Ruling 8). */
export const ANSWER_MS = 10_000;

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
/** Os roteadores de casa e de provedor costumam ser IGD v1; quem usa PPPoE expõe o WANPPPConnection. */
const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
];
/** Os serviços que abrem porta, na ordem de preferência. */
const SERVICES = ["urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"];
const SSDP_MAX = 8 * 1024;
const DESCRIPTION_MAX = 64 * 1024;
const SOAP_MAX = 16 * 1024;

export interface SsdpAnswer {
  location: string;
  /** O IP de quem respondeu. */
  from: string;
}

export interface UpnpTransport {
  /** Manda o M-SEARCH e entrega cada resposta até o sinal abortar. */
  search(signal: AbortSignal): AsyncIterable<SsdpAnswer>;
  /** GET (descrição) ou POST (SOAP) ao roteador; corpo lido com teto. Devolve null se passou do teto. */
  request(
    url: string,
    init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; signal: AbortSignal; max: number },
  ): Promise<{ status: number; text: string } | null>;
}

/** O serviço do roteador que recebe os pedidos SOAP. */
export interface IgdService {
  serviceType: string;
  controlUrl: string;
  /** O IP do roteador (o mesmo de quem respondeu à busca). */
  host: string;
}

export type SoapResult = { ok: true; text: string } | { ok: false; errorCode: number | null; detail: string };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const unescapeXml = (text: string): string =>
  text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name] ?? "");
const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

/** O conteúdo de um elemento XML (com ou sem prefixo), por regex: a descrição e as respostas dos roteadores variam muito. */
function tag(xml: string, name: string): string | null {
  const found = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml);
  return found ? unescapeXml(found[1]!.trim()) : null;
}

/** O LOCATION de uma resposta SSDP; null se não houver ou se o pacote for grande demais. */
export function parseSsdpResponse(packet: Buffer): string | null {
  if (packet.length > SSDP_MAX) return null;
  // A spec pede CRLF, mas há firmware que responde só com LF.
  for (const line of packet.toString("utf8").split(/\r?\n/)) {
    const found = /^location:\s*(.+)$/i.exec(line);
    if (found) return found[1]!.trim();
  }
  return null;
}

/** Quantos endereços diferentes uma busca aceita; um roteador de verdade dá um ou dois. */
const MAX_ANSWERS = 32;

const mSearch = (target: string): Buffer =>
  Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${target}\r\n\r\n`);

/** A rede de verdade: SSDP por `node:dgram` em cada adaptador IPv4 e HTTP pelo `fetch` do Node. */
export function nodeUpnpTransport(interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces, log: (m: string) => void = () => {}): UpnpTransport {
  return {
    async *search(signal) {
      const queue: SsdpAnswer[] = [];
      const seen = new Set<string>();
      let wake: (() => void) | null = null;
      const sockets: Socket[] = [];
      // Um socket por adaptador, preso ao IP dele: a busca sai por cada rede, e nada escuta em 0.0.0.0.
      for (const info of Object.values(interfaces()).flatMap((infos) => infos ?? [])) {
        if (info.internal || info.family !== "IPv4") continue;
        const socket = createSocket("udp4");
        sockets.push(socket);
        socket.on("error", (error) => log(`busca UPnP em ${info.address}: ${error.message}`));
        socket.on("message", (packet, remote) => {
          const location = parseSsdpResponse(packet);
          // Um aparelho que inunde a rede com endereços sempre novos não enche a memória do app.
          if (location === null || seen.has(location) || seen.size >= MAX_ANSWERS) return;
          seen.add(location);
          queue.push({ location, from: remote.address });
          wake?.();
        });
        socket.bind({ address: info.address, port: 0 }, () => {
          try {
            socket.setMulticastInterface(info.address);
          } catch (error) {
            log(`busca UPnP em ${info.address}: ${errorText(error)}`);
          }
          for (const target of SEARCH_TARGETS) {
            socket.send(mSearch(target), SSDP_PORT, SSDP_ADDRESS, (error) => {
              if (error) log(`busca UPnP em ${info.address}: ${error.message}`);
            });
          }
        });
      }
      // Sem adaptador IPv4 não há rede onde procurar (e nada seguraria a espera até o prazo).
      if (sockets.length === 0) return;
      const onAbort = () => wake?.();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        // Passado o prazo, as respostas que ainda estão na fila também ficam de fora.
        while (!signal.aborted) {
          const answer = queue.shift();
          if (answer) {
            yield answer;
            continue;
          }
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        for (const socket of sockets) {
          try {
            socket.close();
          } catch {
            // já fechado pelo erro dele
          }
        }
      }
    },

    async request(url, init) {
      // Sem seguir redirecionamento: o roteador não manda o app buscar outro endereço.
      const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal, redirect: "manual" });
      const declared = Number(response.headers.get("content-length"));
      if (declared > init.max) {
        await response.body?.cancel();
        return null;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          // Sair do laço cancela o resto do corpo.
          if (size > init.max) return null;
          chunks.push(chunk);
        }
      }
      return { status: response.status, text: Buffer.concat(chunks).toString("utf8") };
    },
  };
}

/** O serviço que abre porta, da descrição do roteador; o controlURL tem que apontar para o próprio roteador. */
function pickService(xml: string, location: string, from: string): IgdService | null {
  const base = tag(xml, "URLBase") || location;
  const services = [...xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map((found) => ({ type: tag(found[1]!, "serviceType"), control: tag(found[1]!, "controlURL") }));
  for (const serviceType of SERVICES) {
    const service = services.find((candidate) => candidate.type === serviceType && candidate.control);
    if (!service) continue;
    let url: URL;
    try {
      url = new URL(service.control!, base);
    } catch {
      continue;
    }
    if (url.protocol === "http:" && url.hostname === from) return { serviceType, controlUrl: url.href, host: from };
  }
  return null;
}

/** Lê a descrição de quem respondeu à busca, se a resposta for de um roteador desta rede. */
async function readService(transport: UpnpTransport, answer: SsdpAnswer, search: AbortSignal, isLocal: (host: string) => boolean, log: (m: string) => void): Promise<IgdService | null> {
  let location: URL;
  try {
    location = new URL(answer.location);
  } catch {
    return null;
  }
  // Sem isso, um aparelho da rede poderia mandar o app buscar outro endereço.
  if (location.protocol !== "http:" || location.hostname !== answer.from || !isLocal(answer.from)) return null;
  try {
    const response = await transport.request(location.href, { method: "GET", signal: AbortSignal.any([search, AbortSignal.timeout(ANSWER_MS)]), max: DESCRIPTION_MAX });
    if (response === null || response.status !== 200) return null;
    return pickService(response.text, location.href, answer.from);
  } catch (error) {
    log(`não consegui ler a descrição do roteador ${answer.from} (${errorText(error)})`);
    return null;
  }
}

/** O primeiro roteador desta rede que abre porta, dentro do prazo de busca. */
export async function findIgd(
  transport: UpnpTransport,
  options: { searchMs: number; isLocal(host: string): boolean; log(m: string): void },
): Promise<IgdService | null> {
  const signal = AbortSignal.timeout(options.searchMs);
  let found: IgdService | null = null;
  try {
    for await (const answer of transport.search(signal)) {
      found = await readService(transport, answer, signal, options.isLocal, options.log);
      if (found) break;
    }
  } catch (error) {
    // Um erro ao encerrar a busca não desfaz o roteador já achado.
    options.log(`não consegui procurar o roteador por UPnP (${errorText(error)})`);
  }
  return found;
}

/** Um pedido SOAP ao serviço do roteador. Nunca rejeita: prazo, teto ou rede dão `errorCode: null`. */
export async function soap(
  transport: UpnpTransport,
  service: IgdService,
  action: string,
  args: ReadonlyArray<readonly [string, string | number]>,
  signal: AbortSignal,
): Promise<SoapResult> {
  const values = args.map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`).join("");
  const body =
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${service.serviceType}">${values}</u:${action}></s:Body></s:Envelope>`;
  try {
    const response = await transport.request(service.controlUrl, {
      method: "POST",
      headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${service.serviceType}#${action}"` },
      body,
      signal,
      max: SOAP_MAX,
    });
    if (response === null) return { ok: false, errorCode: null, detail: "resposta grande demais" };
    if (response.status === 200) return { ok: true, text: response.text };
    const code = tag(response.text, "errorCode");
    const errorCode = code !== null && /^\d+$/.test(code) ? Number(code) : null;
    return { ok: false, errorCode, detail: `HTTP ${response.status}${errorCode !== null ? `, erro ${errorCode}` : ""}` };
  } catch (error) {
    return { ok: false, errorCode: null, detail: errorText(error) };
  }
}

/** O texto de um elemento da resposta SOAP (ex.: NewExternalIPAddress). */
export const soapValue = (text: string, name: string): string | null => tag(text, name);
