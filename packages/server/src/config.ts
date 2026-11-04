import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  port: number;
  host: string;
  /** Endereço que o navegador usa; define a origem aceita e os links de convite. */
  publicUrl: URL;
  dataDir: string;
  /** O .tmj do escritório; a imagem do tileset fica na mesma pasta. */
  mapFile: string;
  insecure: boolean;
  trustProxy: boolean;
  /** `self-signed`: o servidor fala HTTPS com um certificado próprio (a rede interna), e o pino dele vai nos convites. */
  tls: "off" | "self-signed";
  /** Certificado (PEM) da CA da rede interna, cujo pino vai nos convites; o HTTPS em si fica com o proxy. */
  pinFile: string | null;
}

export class ServerConfigError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Interfaces que só o próprio computador alcança. */
const LOOPBACK_BINDS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Escutar na rede com o endereço público em HTTP deixa senhas, tokens e terminais sem criptografia para quem acessar
 * pela rede (spec 9, regra 7). Não impede de subir (o Docker local usa isso), mas avisa.
 */
export function exposureWarning(config: ServerConfig): string | null {
  if (LOOPBACK_BINDS.has(config.host) || config.publicUrl.protocol === "https:") return null;
  return `escutando em ${config.host} com ${config.publicUrl.origin} (sem HTTPS): quem acessar pela rede manda senha e token sem criptografia; use HTTPS (ex.: atrás do Caddy) ou deixe o servidor só neste computador (WF_HOST=127.0.0.1; no Docker, publique a porta só em 127.0.0.1)`;
}

const isOn = (value: string | undefined) => value === "1" || value === "true";

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const rawPort = env.WF_PORT?.trim() || "4600";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new ServerConfigError(`WF_PORT inválida: ${env.WF_PORT}`);

  let publicUrl: URL;
  try {
    publicUrl = new URL(env.WF_PUBLIC_URL ?? `http://localhost:${port}`);
  } catch {
    throw new ServerConfigError(`WF_PUBLIC_URL inválida: ${env.WF_PUBLIC_URL}`);
  }
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    throw new ServerConfigError(`WF_PUBLIC_URL precisa ser http ou https: ${env.WF_PUBLIC_URL}`);
  }
  const insecure = isOn(env.WF_INSECURE);
  if (publicUrl.protocol === "http:" && !LOCAL_HOSTS.has(publicUrl.hostname) && !insecure) {
    throw new ServerConfigError(`${publicUrl.origin} usa HTTP sem TLS; use https (ex.: atrás do Caddy) ou WF_INSECURE=1`);
  }

  const rawTls = env.WF_TLS?.trim();
  if (rawTls && rawTls !== "self-signed") throw new ServerConfigError(`WF_TLS inválida: ${rawTls} (use self-signed)`);
  const tls = rawTls ? "self-signed" : "off";
  const rawPinFile = env.WF_TLS_PIN_FILE?.trim();
  if (tls === "self-signed" && publicUrl.protocol !== "https:") throw new ServerConfigError("WF_TLS=self-signed pede WF_PUBLIC_URL com https");
  if (rawPinFile && publicUrl.protocol !== "https:") throw new ServerConfigError("WF_TLS_PIN_FILE pede WF_PUBLIC_URL com https");
  if (tls === "self-signed" && rawPinFile) throw new ServerConfigError("use WF_TLS=self-signed ou WF_TLS_PIN_FILE, não os dois");

  return {
    port,
    host: env.WF_HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: env.WF_DATA_DIR ?? join(homedir(), ".workforces-server"),
    // src/ e dist/ ficam no mesmo nível: ../../../assets aponta para a pasta assets da raiz do repositório nos dois.
    mapFile: env.WF_MAP ? resolve(env.WF_MAP) : fileURLToPath(new URL("../../../assets/map/office.tmj", import.meta.url)),
    insecure,
    trustProxy: isOn(env.WF_TRUST_PROXY),
    tls,
    pinFile: rawPinFile ? resolve(rawPinFile) : null,
  };
}
