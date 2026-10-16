import { CLOSE_CODES, ServerToClient, parseJson, type ClientToServer } from "@workforces/protocol";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

export interface OfficeConnectionHandlers {
  onMessage(message: ServerToClient): void;
  onStatus(status: ConnectionStatus): void;
  onEnd(reason: "unauthorized" | "replaced"): void;
}

export class OfficeConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: number | undefined;
  private stableTimer: number | undefined;
  private stopped = false;

  constructor(private readonly handlers: OfficeConnectionHandlers) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.stableTimer);
    this.socket?.close(1000);
  }

  watch(agentId: string): void {
    this.send({ type: "watch", agentId });
  }

  unwatch(): void {
    this.send({ type: "unwatch" });
  }

  private send(message: ClientToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws/client`);
    this.socket = socket;
    this.handlers.onStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    socket.onopen = () => {
      // A espera só volta ao início depois de uma conexão estável.
      this.stableTimer = window.setTimeout(() => (this.attempt = 0), 10_000);
      this.handlers.onStatus("connected");
    };
    socket.onmessage = (event) => {
      const message = parseJson(ServerToClient, String(event.data));
      if (message) this.handlers.onMessage(message);
    };
    socket.onclose = (event) => {
      window.clearTimeout(this.stableTimer);
      if (this.stopped) return;
      if (event.code === CLOSE_CODES.unauthorized) return this.handlers.onEnd("unauthorized");
      if (event.code === CLOSE_CODES.replacedByNewTab) return this.handlers.onEnd("replaced");
      this.handlers.onStatus("reconnecting");
      const base = Math.min(30_000, 1_000 * 2 ** this.attempt++);
      const delay = base / 2 + Math.random() * (base / 2);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
