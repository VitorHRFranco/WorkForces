import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  port: number;
  host: string;
  /** Endereço que o navegador usa; define a origem aceita e os links de convite. */
  publicUrl: URL;
  dataDir: string;
  clientDir: string;
  insecure: boolean;
  trustProxy: boolean;
}

export class ServerConfigError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isOn = (value: string | undefined) => value === "1" || value === "true";

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const port = Number(env.WF_PORT ?? 4600);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ServerConfigError(`WF_PORT inválida: ${env.WF_PORT}`);

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

  return {
    port,
    host: env.WF_HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: env.WF_DATA_DIR ?? join(homedir(), ".workforces-server"),
    // src/ e dist/ ficam no mesmo nível: ../../client/dist aponta para packages/client/dist nos dois.
    clientDir: env.WF_CLIENT_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
    insecure,
    trustProxy: isOn(env.WF_TRUST_PROXY),
  };
}
