import { PROTOCOL_VERSION, ServerToListener, parseJson, type SpawnError } from "@workforces/protocol";
import { BridgeSocket } from "./bridge-socket.js";

export interface ListenerConnectionOptions {
  url: string;
  token: string;
  log: (message: string) => void;
  /** Os apelidos anunciados no hello. */
  aliases: readonly string[];
  onOpen(): void;
  onDrop(): void;
  /** O escritório pediu para abrir um agente; a resposta vai por `sendResult`. */
  onSpawn(reqId: string, alias: string): void;
  onFatal(message: string): void;
  random?: () => number;
  stableMs?: number;
}

/** A conexão do ouvinte (`workforces ponte`): anuncia as pastas e recebe só `spawn`, com o apelido. */
export class ListenerConnection {
  private readonly socket: BridgeSocket;
  private aliases: readonly string[];

  constructor(options: ListenerConnectionOptions) {
    this.aliases = [...options.aliases];
    this.socket = new BridgeSocket({
      url: options.url,
      token: options.token,
      log: options.log,
      random: options.random,
      stableMs: options.stableMs,
      hello: () => ({ type: "hello", protocol: PROTOCOL_VERSION, kind: "listener", aliases: this.aliases }),
      onOpen: () => options.onOpen(),
      onMessage: (text) => {
        const message = parseJson(ServerToListener, text);
        if (!message) {
          options.log("mensagem inválida do servidor ignorada");
          return;
        }
        options.onSpawn(message.reqId, message.alias);
      },
      onDrop: () => options.onDrop(),
      onFatal: (message) => options.onFatal(message),
    });
  }

  start(): void {
    this.socket.start();
  }

  /** Troca a lista anunciada: com a conexão aberta, avisa o servidor na hora; senão, vai no próximo hello. */
  updateAliases(aliases: readonly string[]): void {
    this.aliases = [...aliases];
    this.socket.send({ type: "aliases", aliases: this.aliases });
  }

  sendResult(reqId: string, ok: boolean, error?: SpawnError): boolean {
    return this.socket.send({ type: "spawnResult", reqId, ok, ...(error ? { error } : {}) });
  }

  close(): void {
    this.socket.close();
  }
}
