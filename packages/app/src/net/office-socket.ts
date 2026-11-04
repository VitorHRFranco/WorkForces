import { CLOSE_CODES, type SocketEvent } from "@workforces/protocol";
import { WebSocket } from "ws";
import type { ForwardTarget } from "../state.js";
import { socketTls } from "./pinned.js";

const NORMAL_CLOSE = 1000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
/** Faixa de códigos de fechamento que a aplicação pode usar (RFC 6455). */
const APP_CLOSE_MIN = 3000;
const APP_CLOSE_MAX = 4999;

function validCloseCode(code: number): number {
  return code === NORMAL_CLOSE || (Number.isInteger(code) && code >= APP_CLOSE_MIN && code <= APP_CLOSE_MAX) ? code : NORMAL_CLOSE;
}

/** O WebSocket do escritório vive aqui, no processo principal; a página só recebe eventos e manda texto. Uma conexão por vez. */
export class SocketRelay {
  private current: { id: number; ws: WebSocket } | null = null;
  /** Conexões que fechamos aqui (`open`, `close`, `closeAll`): o 4001 delas não é a sessão acabando. */
  private readonly closedHere = new WeakSet<WebSocket>();

  constructor(
    private readonly emit: (id: number, event: SocketEvent) => void,
    private readonly onUnauthorized: () => void,
  ) {}

  open(id: number, target: ForwardTarget | null): void {
    this.closeAll();
    if (target === null || target.session === null) {
      this.emit(id, { type: "close", code: CLOSE_CODES.unauthorized });
      return;
    }
    const ws = new WebSocket(`${new URL(target.url).origin.replace(/^http/, "ws")}/ws/client`, {
      headers: { authorization: `Bearer ${target.session}` },
      maxPayload: MAX_PAYLOAD_BYTES,
      ...socketTls(target.anchor),
    });
    this.current = { id, ws };
    ws.on("open", () => this.emit(id, { type: "open" }));
    ws.on("message", (data, isBinary) => {
      if (!isBinary) this.emit(id, { type: "message", data: data.toString() });
    });
    // Erro de rede: o `ws` fecha em seguida com 1006, e é esse `close` que a página vê.
    ws.on("error", () => {});
    ws.on("close", (code) => {
      const live = this.current?.ws === ws;
      if (live) this.current = null;
      // Só vale o 4001 que o escritório mandou à conexão viva.
      if (code === CLOSE_CODES.unauthorized && live && !this.closedHere.has(ws)) this.onUnauthorized();
      this.emit(id, { type: "close", code });
    });
  }

  send(id: number, text: string): void {
    if (this.current?.id === id && this.current.ws.readyState === WebSocket.OPEN) this.current.ws.send(text);
  }

  close(id: number, code: number): void {
    if (this.current?.id !== id) return;
    this.closedHere.add(this.current.ws);
    this.current.ws.close(validCloseCode(code));
  }

  /** Fecha a conexão viva (1000). O `close` dela ainda chega à página com o id antigo; só não vale como sessão expirada. */
  closeAll(): void {
    const old = this.current;
    this.current = null;
    if (old === null) return;
    this.closedHere.add(old.ws);
    old.ws.close(NORMAL_CLOSE);
  }
}
