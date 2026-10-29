import { chmodSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { AppToAgent, LOCAL_PROTOCOL_VERSION, parseJson, type AgentToApp, type LocalInfo, type LocalStart } from "@workforces/protocol";

/** Quem conecta e não manda o `hello` neste prazo é derrubado. */
export const HELLO_TIMEOUT_MS = 5_000;
/** Maior linha aceita do app (a maior mensagem válida, o `start`, fica bem abaixo). */
export const MAX_LINE_BYTES = 64 * 1024;
/** Acima disto na fila, o app não está lendo: `send` descarta, e o espelho recomeça com quadro-chave. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface LocalChannelHandlers {
  onStart(start: LocalStart): void;
  onInput(data: string): void;
  onWatch(on: boolean): void;
  info(): Omit<LocalInfo, "type">;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Socket Unix fora do Windows: a pasta é só deste usuário, ou o canal não abre. */
function preparePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.()) throw new Error(`a pasta ${dir} não é deste usuário`);
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/**
 * Servidor do canal local do invólucro: um cliente por vez (o app), uma mensagem JSON por linha.
 * Nada sai e nada entra antes do `hello`: no Windows, outros usuários só têm leitura num pipe,
 * então quem não pode escrever o `hello` não vê nada.
 */
export class LocalChannel {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly helloTimeoutMs: number;
  private current: Socket | null = null;
  private started = false;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly handlers: LocalChannelHandlers,
    private readonly log: (message: string) => void,
    options: { helloTimeoutMs?: number } = {},
  ) {
    this.helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.server = createServer((socket) => this.accept(socket));
  }

  async listen(): Promise<void> {
    if (process.platform !== "win32") {
      preparePrivateDir(dirname(this.path));
      // Um socket Unix fica no disco depois que o processo morre.
      rmSync(this.path, { force: true });
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.path, () => {
        this.server.removeListener("error", reject);
        this.server.on("error", (error) => this.log(`erro no canal local: ${errorMessage(error)}`));
        resolve();
      });
    });
  }

  /** Escreve só para o cliente atual; false sem cliente ou com a fila cheia. */
  send(message: AgentToApp): boolean {
    const socket = this.current;
    if (!socket || socket.destroyed || socket.writableLength > MAX_BUFFERED_BYTES) return false;
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.current = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    if (this.closed) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    let authenticated = false;
    let pending: Buffer = Buffer.alloc(0);
    const helloTimer = setTimeout(() => this.drop(socket, "conexão sem hello no prazo"), this.helloTimeoutMs);

    socket.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      for (let end = pending.indexOf(0x0a); end !== -1; end = pending.indexOf(0x0a)) {
        if (end > MAX_LINE_BYTES) return this.drop(socket, "linha grande demais");
        const message = parseJson(AppToAgent, pending.subarray(0, end).toString("utf8"));
        pending = pending.subarray(end + 1);
        if (!message) return this.drop(socket, "mensagem inválida");
        if (!authenticated) {
          if (message.type !== "hello") return this.drop(socket, `${message.type} antes do hello`);
          if (message.protocol !== LOCAL_PROTOCOL_VERSION) {
            return this.drop(socket, `hello na versão ${message.protocol}; esta ponte usa a ${LOCAL_PROTOCOL_VERSION}`);
          }
          authenticated = true;
          clearTimeout(helloTimer);
          this.adopt(socket);
        } else {
          this.handle(socket, message);
        }
        if (socket.destroyed) return;
      }
      if (pending.length > MAX_LINE_BYTES) this.drop(socket, "linha grande demais");
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      this.sockets.delete(socket);
      if (this.current !== socket) return;
      this.current = null;
      this.call("onWatch", () => this.handlers.onWatch(false));
    });

    socket.on("error", (error) => this.log(`erro numa conexão do canal local: ${errorMessage(error)}`));
  }

  /** Um `hello` válido: este passa a ser o cliente atual, e o anterior cai. */
  private adopt(socket: Socket): void {
    const previous = this.current;
    this.current = socket;
    this.sendInfo();
    if (previous) {
      previous.destroy();
      this.call("onWatch", () => this.handlers.onWatch(false));
    }
  }

  private handle(socket: Socket, message: AppToAgent): void {
    if (socket !== this.current) return;
    switch (message.type) {
      case "hello":
        this.sendInfo();
        return;
      case "start":
        // As credenciais valem uma vez na vida do canal: outro cliente não troca o escritório depois.
        if (this.started) {
          this.log("start repetido no canal local ignorado");
          return;
        }
        this.started = true;
        this.call("onStart", () => this.handlers.onStart(message));
        this.sendInfo();
        return;
      case "watch":
      case "unwatch":
        this.call("onWatch", () => this.handlers.onWatch(message.type === "watch"));
        return;
      case "input":
        this.call("onInput", () => this.handlers.onInput(message.data));
        return;
    }
  }

  private sendInfo(): void {
    this.call("info", () => this.send({ type: "info", ...this.handlers.info() }));
  }

  private drop(socket: Socket, reason: string): void {
    this.log(`canal local: ${reason}; conexão fechada`);
    socket.destroy();
  }

  /** Um handler que lança não derruba o canal nem o invólucro. */
  private call(what: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.log(`erro no canal local (${what}): ${errorMessage(error)}`);
    }
  }
}
