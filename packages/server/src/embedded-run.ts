import type { EmbeddedToHost, HostToEmbedded } from "@workforces/protocol";
import { ServerConfigError, loadServerConfig } from "./config.js";
import { startServer } from "./server.js";

export interface EmbeddedChannel {
  send(message: EmbeddedToHost): void;
  onStop(listener: () => void): void;
}

/** Sobe o servidor para o app que o hospeda; conta o resultado pelo canal. `null` quando não subiu. */
export async function runEmbedded(
  env: NodeJS.ProcessEnv,
  channel: EmbeddedChannel,
  log: (message: string) => void,
): Promise<{ close(): Promise<void> } | null> {
  const fail = (reason: "port-in-use" | "error", message: string) => {
    channel.send({ type: "failed", reason, message });
    return null;
  };
  let config;
  try {
    config = loadServerConfig(env);
  } catch (error) {
    if (!(error instanceof ServerConfigError)) throw error;
    return fail("error", error.message);
  }
  // Sem TLS próprio o pino do convite não existiria, e o app não conseguiria confiar no escritório.
  if (config.tls !== "self-signed") return fail("error", "o servidor embutido precisa de WF_TLS=self-signed");
  let adminInvite: string | null = null;
  let server;
  try {
    // O código do convite vai só para esta variável, nunca para o log.
    server = await startServer(config, { log, onAdminInvite: (code) => (adminInvite = code) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return fail("port-in-use", `a porta ${config.port} já está em uso`);
    return fail("error", error instanceof Error ? error.message : String(error));
  }
  const current = server.ctx.pin?.current();
  if (!current) {
    await server.app.close().catch(() => {});
    return fail("error", "o servidor não gerou o certificado");
  }
  channel.send({ type: "ready", pin: current.pin, anchor: current.anchor, adminInvite });
  channel.onStop(() => void server.app.close().catch(() => {}));
  return { close: () => server.app.close() };
}

/** Liga o `runEmbedded` ao canal IPC do `fork`; sem canal, quem rodou não foi o app. */
export async function main(): Promise<void> {
  const send = process.send?.bind(process);
  if (!send) {
    console.error("uso: rode pelo app do WorkForces");
    process.exit(2);
  }
  const channel: EmbeddedChannel = {
    send: (message) => void send(message),
    // O `main` trata o "stop" por conta própria (fecha e sai).
    onStop: () => {},
  };
  const starting = runEmbedded(process.env, channel, (message) => console.log(message));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void starting.then((handle) => handle?.close().catch(() => {})).finally(() => process.exit(0));
  };
  process.on("message", (message) => {
    if ((message as HostToEmbedded | null)?.type === "stop") stop();
  });
  // O app caiu: sem ele ninguém para o servidor.
  process.on("disconnect", stop);
  process.once("SIGTERM", stop);
  if (!(await starting)) {
    // Não subiu: o `failed` já foi; fecha o canal (isso descarrega a mensagem) e deixa o processo acabar.
    process.removeListener("disconnect", stop);
    process.exitCode = 1;
    process.disconnect();
  }
}
