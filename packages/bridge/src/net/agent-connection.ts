import { LIMITS, PROTOCOL_VERSION, ServerToAgent, parseJson, type AgentHello, type AgentToServer } from "@workforces/protocol";
import { BridgeSocket } from "./bridge-socket.js";

export { MAX_BUFFERED_BYTES, STABLE_CONNECTION_MS, ServerUrlError, bridgeSocketUrl } from "./bridge-socket.js";

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

/** A conexão de um `workforces claude`: manda hello, quadros e status; do servidor só chega `viewers`. */
export class AgentConnection implements AgentLink {
  private readonly socket: BridgeSocket;
  private hello: AgentConnectionOptions["hello"];

  constructor(options: AgentConnectionOptions) {
    this.hello = { ...options.hello };
    this.socket = new BridgeSocket({
      url: options.url,
      token: options.token,
      log: options.log,
      random: options.random,
      stableMs: options.stableMs,
      hello: () => ({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        kind: "agent",
        agentId: this.hello.agentId,
        label: this.hello.label,
        cols: Math.max(1, Math.min(this.hello.cols, LIMITS.maxCols)),
        rows: Math.max(1, Math.min(this.hello.rows, LIMITS.maxRows)),
      }),
      onOpen: () => options.handlers.onOpen(),
      onMessage: (text) => {
        const message = parseJson(ServerToAgent, text);
        if (!message) {
          options.log("mensagem inválida do servidor ignorada");
          return;
        }
        options.handlers.onViewers(message.n);
      },
      onDrop: () => options.handlers.onViewers(0),
      onFatal: (message) => options.handlers.onFatal(message),
    });
  }

  start(): void {
    this.socket.start();
  }

  send(message: AgentToServer): boolean {
    return this.socket.send(message);
  }

  updateSize(cols: number, rows: number): void {
    this.hello = { ...this.hello, cols, rows };
  }

  close(): void {
    this.socket.close();
  }
}
