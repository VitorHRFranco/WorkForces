import { CLOSE_CODES } from "@workforces/protocol";
import WebSocket from "ws";
import { reconnectDelay } from "./backoff.js";

/**
 * Maior que o maior quadro-chave possível (500×200 com cor 24 bits ≈ 4,2 MB);
 * senão um quadro-chave grande nunca termina de sair.
 */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** Só depois de uma conexão ficar aberta este tempo a espera de reconexão volta ao início. */
export const STABLE_CONNECTION_MS = 10_000;
/** As mensagens do servidor para a ponte são minúsculas (`viewers`, `spawn`). */
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

export interface BridgeSocketOptions {
  url: string;
  token: string;
  log: (message: string) => void;
  /** Primeira mensagem de cada conexão (o hello), montada na hora com os dados mais recentes. */
  hello(): unknown;
  onOpen(): void;
  onMessage(text: string): void;
  /** A conexão caiu e vai tentar de novo. */
  onDrop(): void;
  onFatal(message: string): void;
  random?: () => number;
  stableMs?: number;
}

/**
 * Conexão autenticada com `/ws/bridge`, usada pelo agente e pelo ouvinte: reconecta sozinha com espera crescente
 * e para de tentar nos erros fatais (token recusado, versão incompatível).
 */
export class BridgeSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private rejected = false;
  private closed = false;

  constructor(private readonly options: BridgeSocketOptions) {}

  start(): void {
    this.connect();
  }

  /** false = sem conexão aberta, ou fila acima do limite. */
  send(message: unknown): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    socket.send(JSON.stringify(message));
    return true;
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
      socket.send(JSON.stringify(this.options.hello()));
      this.options.onOpen();
    });

    socket.on("message", (data) => {
      if (this.closed || this.socket !== socket) return;
      this.options.onMessage(data.toString());
    });

    socket.on("error", (err) => {
      // Um proxy (ou servidor) que pede autenticação no upgrade (401) não manda o código 4001; um 403 de intermediário pode ser passageiro e segue o backoff.
      if (/Unexpected server response: 401\b/.test(err.message)) this.rejected = true;
      this.options.log(`erro na conexão: ${err.message}`);
    });

    socket.on("close", (code) => {
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = null;
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      if (code === CLOSE_CODES.unauthorized || this.rejected) {
        this.closed = true;
        this.options.onFatal("token revogado ou inválido: rode `workforces login`");
        return;
      }
      if (code === CLOSE_CODES.protocolMismatch) {
        this.closed = true;
        this.options.onFatal("versão do protocolo incompatível com o servidor: atualize a ponte");
        return;
      }
      this.options.onDrop();
      const delay = reconnectDelay(this.attempt++, this.options.random);
      this.options.log(`conexão fechada (${code}); nova tentativa em ${delay} ms`);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
