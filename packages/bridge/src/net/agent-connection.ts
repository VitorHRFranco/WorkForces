import {
  CLOSE_CODES,
  LIMITS,
  PROTOCOL_VERSION,
  ServerToAgent,
  parseJson,
  type AgentHello,
  type AgentToServer,
} from "@workforces/protocol";
import WebSocket from "ws";
import { reconnectDelay } from "./backoff.js";

/**
 * Maior que o maior quadro-chave possível (500×200 com cor 24 bits ≈ 4,2 MB);
 * senão um quadro-chave grande nunca termina de sair.
 */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** Só depois de uma conexão ficar aberta este tempo a espera de reconexão volta ao início. */
export const STABLE_CONNECTION_MS = 10_000;
/** As mensagens do servidor para a ponte são minúsculas (`viewers`). */
const SERVER_MAX_PAYLOAD = 64 * 1024;

export class ServerUrlError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** URL do WebSocket da ponte a partir da URL do escritório. */
export function bridgeSocketUrl(server: string, insecure: boolean): string {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new ServerUrlError(`URL de servidor inválida: ${server}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerUrlError(`URL de servidor inválida: ${server}`);
  }
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname) && !insecure) {
    throw new ServerUrlError(`${server} usa HTTP sem TLS; use https ou faça login com --insecure`);
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/bridge";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export interface LinkEvents {
  onOpen(): void;
  onViewers(n: number): void;
}

export interface AgentConnectionHandlers extends LinkEvents {
  onFatal(message: string): void;
}

/** O que o invólucro enxerga da conexão. Não existe caminho de entrada para o PTY. */
export interface AgentLink {
  send(message: AgentToServer): boolean;
  updateSize(cols: number, rows: number): void;
  close(): void;
}

export interface AgentConnectionOptions {
  url: string;
  token: string;
  hello: Pick<AgentHello, "agentId" | "label" | "cols" | "rows">;
  handlers: AgentConnectionHandlers;
  log: (message: string) => void;
  random?: () => number;
  stableMs?: number;
}

export class AgentConnection implements AgentLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private rejected = false;
  private closed = false;
  private hello: AgentConnectionOptions["hello"];

  constructor(private readonly options: AgentConnectionOptions) {
    this.hello = { ...options.hello };
  }

  start(): void {
    this.connect();
  }

  send(message: AgentToServer): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  updateSize(cols: number, rows: number): void {
    this.hello = { ...this.hello, cols, rows };
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.socket?.close(1000);
    this.socket = null;
  }

  private connect(): void {
    if (this.closed) return;
    this.rejected = false;
    const socket = new WebSocket(this.options.url, {
      headers: { authorization: `Bearer ${this.options.token}` },
      maxPayload: SERVER_MAX_PAYLOAD,
    });
    this.socket = socket;

    socket.on("open", () => {
      this.stableTimer = setTimeout(() => {
        this.attempt = 0;
      }, this.options.stableMs ?? STABLE_CONNECTION_MS);
      socket.send(
        JSON.stringify({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          kind: "agent",
          agentId: this.hello.agentId,
          label: this.hello.label,
          cols: Math.max(1, Math.min(this.hello.cols, LIMITS.maxCols)),
          rows: Math.max(1, Math.min(this.hello.rows, LIMITS.maxRows)),
        }),
      );
      this.options.handlers.onOpen();
    });

    socket.on("message", (data) => {
      if (this.closed || this.socket !== socket) return;
      const message = parseJson(ServerToAgent, data.toString());
      if (!message) {
        this.options.log("mensagem inválida do servidor ignorada");
        return;
      }
      this.options.handlers.onViewers(message.n);
    });

    socket.on("error", (err) => {
      // Um proxy (ou servidor) que recusa o upgrade com 401/403 não manda o código 4001.
      if (/Unexpected server response: (401|403)\b/.test(err.message)) this.rejected = true;
      this.options.log(`erro na conexão: ${err.message}`);
    });

    socket.on("close", (code) => {
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = null;
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      if (code === CLOSE_CODES.unauthorized || this.rejected) {
        this.closed = true;
        this.options.handlers.onFatal("token revogado ou inválido: rode `workforces login`");
        return;
      }
      if (code === CLOSE_CODES.protocolMismatch) {
        this.closed = true;
        this.options.handlers.onFatal("versão do protocolo incompatível com o servidor: atualize a ponte");
        return;
      }
      this.options.handlers.onViewers(0);
      const delay = reconnectDelay(this.attempt++, this.options.random);
      this.options.log(`conexão fechada (${code}); nova tentativa em ${delay} ms`);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
