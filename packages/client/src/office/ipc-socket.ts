import type { AppBridge } from "@workforces/protocol";
import type { SocketLike } from "./connection";

let nextId = 1;

/** O socket do escritório mora no processo principal; esta classe só o apresenta à página como um WebSocket. */
export class IpcSocket implements SocketLike {
  readonly id = nextId++;
  /** 0 conectando, 1 aberto, 2 fechando, 3 fechado. */
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly socket: AppBridge["socket"]) {
    // O processo principal ainda avisa o fechamento de um id antigo, ao trocar de conexão: só vale o próprio id.
    this.unsubscribe = socket.onEvent((id, event) => {
      if (id !== this.id) return;
      if (event.type === "open") {
        this.readyState = 1;
        this.onopen?.();
      } else if (event.type === "message") {
        this.onmessage?.({ data: event.data });
      } else {
        this.readyState = 3;
        this.unsubscribe();
        this.onclose?.({ code: event.code });
      }
    });
    socket.open(this.id);
  }

  send(data: string): void {
    if (this.readyState === 1) this.socket.send(this.id, data);
  }

  close(code = 1000): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.socket.close(this.id, code);
  }
}
