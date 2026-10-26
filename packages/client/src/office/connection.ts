import { CLOSE_CODES, PROTOCOL_VERSION, ServerToClient, parseJson, type ClientToServer, type Direction } from "@workforces/protocol";
import { SendBudget, type SendKind } from "./send-budget";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

/** Um pedido de agente a cada 5 s no servidor (spec 6.7); o navegador espera um pouco mais para nunca passar do limite. */
export const SPAWN_COOLDOWN_MS = 5_500;

export type SpawnRequest = { ok: true; reqId: string } | { ok: false; reason: "cooldown" | "offline" };

export interface OfficeConnectionHandlers {
  onMessage(message: ServerToClient): void;
  onStatus(status: ConnectionStatus): void;
  onEnd(reason: "unauthorized" | "replaced" | "outdated" | "origin"): void;
}

export class OfficeConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: number | undefined;
  private stableTimer: number | undefined;
  private stopped = false;
  /** Tentativa marcada de refazer um watch que o limite por segundo descartou. */
  private pendingWatch: number | undefined;
  private lastSpawnAt = Number.NEGATIVE_INFINITY;
  private spawnCount = 0;
  private readonly budget = new SendBudget();

  constructor(private readonly handlers: OfficeConnectionHandlers) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.stableTimer);
    window.clearTimeout(this.pendingWatch);
    this.socket?.close(1000);
  }

  /** Pede a tela do agente. Se o limite por segundo descartar o pedido, tenta de novo assim que abrir vaga. */
  watch(agentId: string): void {
    window.clearTimeout(this.pendingWatch);
    if (this.send({ type: "watch", agentId }) || this.socket?.readyState !== WebSocket.OPEN) return;
    // Sem isto, o painel ficaria em branco até sair e voltar à mesa. Com a conexão caída, o welcome refaz o watch.
    const wait = Math.max(0, this.budget.nextAllowedAt("watch", Date.now()) - Date.now());
    this.pendingWatch = window.setTimeout(() => this.watch(agentId), wait);
  }

  unwatch(): void {
    window.clearTimeout(this.pendingWatch);
    this.send({ type: "unwatch" });
  }

  /** Abre ou fecha a própria mesa; a resposta chega como `deskUpdated` (conta na mesma cota do watch). */
  setDeskClosed(closed: boolean): boolean {
    return this.send({ type: "setDeskClosed", closed });
  }

  /** Pede à ponte da própria pessoa para abrir um agente; a resposta chega depois, como `spawnResult` com o mesmo reqId. */
  spawnAgent(alias: string): SpawnRequest {
    const now = Date.now();
    if (now - this.lastSpawnAt < SPAWN_COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    const reqId = `s${now.toString(36)}-${++this.spawnCount}`;
    if (!this.send({ type: "spawnAgent", reqId, alias })) return { ok: false, reason: "offline" };
    this.lastSpawnAt = now;
    return { ok: true, reqId };
  }

  move(x: number, y: number, dir: Direction, moving: boolean): boolean {
    return this.send({ type: "move", x, y, dir, moving });
  }

  /** false = não mandou (limite de mensagens por segundo); a caixa de chat avisa. */
  chat(text: string): boolean {
    return this.send({ type: "chat", text });
  }

  private send(message: ClientToServer): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    // Um watch descartado aqui é refeito pelo próprio watch(), quando abre vaga.
    // spawnAgent tem a própria espera (SPAWN_COOLDOWN_MS) e não gasta vaga de watch.
    const kind: SendKind | null = message.type === "move" ? "move" : message.type === "chat" ? "chat" : message.type === "spawnAgent" ? null : "watch";
    if (kind !== null && !this.budget.allow(kind, Date.now())) return false;
    this.socket.send(JSON.stringify(message));
    return true;
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
      const text = String(event.data);
      // Lê só o envelope do welcome antes do esquema completo: um servidor de versão nova pode não validar no esquema antigo.
      try {
        const envelope: unknown = JSON.parse(text);
        if (typeof envelope === "object" && envelope !== null && "type" in envelope && envelope.type === "welcome" && "protocol" in envelope && envelope.protocol !== PROTOCOL_VERSION) {
          this.stop();
          this.handlers.onEnd("outdated");
          return;
        }
      } catch {
        // JSON inválido: o parseJson abaixo descarta.
      }
      const message = parseJson(ServerToClient, text);
      if (message) this.handlers.onMessage(message);
    };
    socket.onclose = (event) => {
      window.clearTimeout(this.stableTimer);
      if (this.stopped) return;
      if (event.code === CLOSE_CODES.unauthorized) return this.handlers.onEnd("unauthorized");
      if (event.code === CLOSE_CODES.replacedByNewTab) return this.handlers.onEnd("replaced");
      if (event.code === CLOSE_CODES.originNotAllowed) return this.handlers.onEnd("origin");
      this.handlers.onStatus("reconnecting");
      const base = Math.min(30_000, 1_000 * 2 ** this.attempt++);
      const delay = base / 2 + Math.random() * (base / 2);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
