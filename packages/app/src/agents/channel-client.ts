import { connect, type Socket } from "node:net";
import { AgentToApp, LOCAL_PROTOCOL_VERSION, parseJson, type AppToAgent, type LocalInfo } from "@workforces/protocol";

/** Maior linha aceita do invólucro (um quadro cheio cabe com folga). */
export const MAX_AGENT_LINE_BYTES = 1024 * 1024;

const CONNECT_TIMEOUT_MS = 3_000;

/** Cliente do canal local de um agente: uma mensagem JSON por linha, em named pipe ou socket Unix. */
export class AgentChannelClient {
  /** Atualizado a cada `info` que o invólucro manda. */
  info!: LocalInfo;
  private handler: ((message: AgentToApp) => void) | null = null;
  /** Mensagens que chegaram sem ninguém ouvindo (logo depois do primeiro `info`); saem quando `onMessage` é posto. */
  private queued: AgentToApp[] = [];
  onClose: (() => void) | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private onFirstInfo: ((info: LocalInfo) => void) | null = null;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.read(chunk));
    socket.on("close", () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose?.();
    });
    socket.on("error", () => {});
  }

  /** Conecta, manda o `hello` e espera o primeiro `info`; rejeita se recusar, demorar ou falar fora do protocolo. */
  static connect(path: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<AgentChannelClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      const client = new AgentChannelClient(socket);
      const fail = (reason: string) => {
        clearTimeout(timer);
        client.onFirstInfo = null;
        socket.destroy();
        reject(new Error(reason));
      };
      const timer = setTimeout(() => fail("o agente não respondeu no prazo"), timeoutMs);
      client.onClose = () => fail("canal fechado antes do info");
      client.onFirstInfo = () => {
        clearTimeout(timer);
        client.onClose = null;
        resolve(client);
      };
      socket.on("error", (error) => fail(error.message));
      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ type: "hello", protocol: LOCAL_PROTOCOL_VERSION })}\n`);
      });
    });
  }

  get onMessage(): ((message: AgentToApp) => void) | null {
    return this.handler;
  }

  set onMessage(handler: ((message: AgentToApp) => void) | null) {
    this.handler = handler;
    while (handler && this.handler === handler && this.queued.length > 0) handler(this.queued.shift()!);
  }

  send(message: AppToAgent): boolean {
    if (this.closed || this.socket.destroyed) return false;
    this.socket.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  close(): void {
    this.socket.destroy();
  }

  private read(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (let end = this.buffer.indexOf(0x0a); end !== -1; end = this.buffer.indexOf(0x0a)) {
      if (end > MAX_AGENT_LINE_BYTES) {
        this.socket.destroy();
        return;
      }
      const message = parseJson(AgentToApp, this.buffer.subarray(0, end).toString("utf8"));
      this.buffer = this.buffer.subarray(end + 1);
      if (!message) {
        this.socket.destroy();
        return;
      }
      if (message.type === "info") {
        this.info = message;
        const first = this.onFirstInfo;
        this.onFirstInfo = null;
        if (first) first(message);
      } else if (this.onFirstInfo) {
        // O primeiro que o invólucro manda tem de ser o `info`.
        this.socket.destroy();
        return;
      }
      if (this.handler) this.handler(message);
      else if (this.queued.length < 100) this.queued.push(message);
      if (this.socket.destroyed) return;
    }
    if (this.buffer.length > MAX_AGENT_LINE_BYTES) this.socket.destroy();
  }
}
