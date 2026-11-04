import { createHash, X509Certificate } from "node:crypto";
import type { TlsAnchor } from "@workforces/protocol";
import { Agent, fetch as undiciFetch } from "undici";

const ANCHOR_TIMEOUT_MS = 5_000;
/** Um certificado cabe em poucos KiB; mais que isso não é a âncora. */
const MAX_ANCHOR_BYTES = 64 * 1024;

/** O pino de um certificado: SHA-256 do DER em base64url. Cópia da do servidor (o app não depende do pacote dele). */
export function pinOfCertificate(pem: string): string {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("base64url");
}

/** Lê o corpo até o teto; null se passar dele. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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
    const text = await readCapped(response.body, MAX_ANCHOR_BYTES);
    if (text === null) return { ok: false, error: "unreachable" };
    const { anchor } = JSON.parse(text) as Partial<TlsAnchor>;
    if (typeof anchor !== "string") return { ok: false, error: "unreachable" };
    return pinOfCertificate(anchor) === pin ? { ok: true, anchor } : { ok: false, error: "mismatch" };
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
