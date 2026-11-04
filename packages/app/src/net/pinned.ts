import { createHash, X509Certificate } from "node:crypto";
import type { TlsAnchor } from "@workforces/protocol";
import { Agent, fetch as undiciFetch } from "undici";
import { readCapped } from "./read-capped.js";

const ANCHOR_TIMEOUT_MS = 5_000;
/** Um certificado cabe em poucos KiB; mais que isso não é a âncora. */
const MAX_ANCHOR_BYTES = 64 * 1024;
/** Teto da âncora já normalizada; o `offices.json` usa o mesmo, para o que a rede aceita ser sempre o que o arquivo lê. */
export const MAX_ANCHOR_LENGTH = 16_384;

/** O pino de um certificado: SHA-256 do DER em base64url. Cópia da do servidor (o app não depende do pacote dele). */
export function pinOfCertificate(pem: string): string {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("base64url");
}

/**
 * Busca a âncora do escritório e confere com o pino do convite. A conexão aqui não valida o certificado (ainda não há
 * em quem confiar): quem vale é o pino, e depois só a âncora guardada é aceita.
 */
export async function fetchAnchor(
  url: string,
  pin: string,
  timeoutMs?: number,
): Promise<{ ok: true; anchor: string } | { ok: false; error: "unreachable" | "mismatch" }> {
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  try {
    const response = await undiciFetch(new URL("/api/tls/anchor", url), { dispatcher: agent, redirect: "manual", signal: AbortSignal.timeout(timeoutMs ?? ANCHOR_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, error: "unreachable" };
    const body = await readCapped(response as unknown as Response, MAX_ANCHOR_BYTES);
    if (body === null) return { ok: false, error: "unreachable" };
    const { anchor } = JSON.parse(new TextDecoder().decode(body)) as Partial<TlsAnchor>;
    // Mais de um certificado seria confiança extra que o pino não cobre; só um vale como âncora.
    if (typeof anchor !== "string" || (anchor.match(/-----BEGIN /g) ?? []).length !== 1) return { ok: false, error: "unreachable" };
    // Só o certificado conferido é guardado: o texto em volta (ou além) dele nunca vira confiança.
    const normalized = new X509Certificate(anchor).toString();
    if (normalized.length > MAX_ANCHOR_LENGTH) return { ok: false, error: "unreachable" };
    return pinOfCertificate(normalized) === pin ? { ok: true, anchor: normalized } : { ok: false, error: "mismatch" };
  } catch {
    // Rede, tempo, JSON ou PEM que não se lê: de fora, é o escritório que não respondeu direito.
    return { ok: false, error: "unreachable" };
  } finally {
    await agent.close().catch(() => {});
  }
}

/** Um agente por âncora (a chave vazia é o do sistema): reaproveita as conexões abertas. */
const agents = new Map<string, Agent>();

function agentFor(anchor: string | null): Agent {
  const key = anchor ?? "";
  let agent = agents.get(key);
  if (!agent) {
    // O nome do certificado não vale: o endereço do convite pode ser um IP, e quem prova o escritório é a âncora.
    agent = new Agent(anchor === null ? {} : { connect: { ca: anchor, checkServerIdentity: () => undefined } });
    agents.set(key, agent);
  }
  return agent;
}

/** O `fetch` de um escritório: com âncora, confia só nela; sem, só nas CAs do sistema. */
export function officeFetch(anchor: string | null): typeof fetch {
  const dispatcher = agentFor(anchor);
  type Args = Parameters<typeof undiciFetch>;
  return ((input: Args[0], init?: Args[1]) => undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}

/** As opções de TLS do `ws` para um escritório: com âncora, confia só nela. */
export function socketTls(anchor: string | null): { ca?: string; checkServerIdentity?: () => undefined } {
  return anchor === null ? {} : { ca: anchor, checkServerIdentity: () => undefined };
}
