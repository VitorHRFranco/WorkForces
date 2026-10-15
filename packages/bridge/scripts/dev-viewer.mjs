// Visualizador de desenvolvimento: finge ser o servidor para UMA ponte e desenha os
// quadros recebidos neste terminal, como um visitante veria. Só escuta em 127.0.0.1.
// Uso: node packages/bridge/scripts/dev-viewer.mjs [porta]
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 4599);
const wss = new WebSocketServer({ host: "127.0.0.1", port, path: "/ws/bridge" });
console.log(`dev-viewer em ws://127.0.0.1:${port}/ws/bridge, aguardando a ponte…`);

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "hello") {
      process.stdout.write(`\x1b[2J\x1b[Hponte conectada: ${message.label} ${message.cols}x${message.rows}\r\n`);
      socket.send(JSON.stringify({ type: "viewers", n: 1 }));
      return;
    }
    if (message.type === "status") {
      process.title = `agente: ${message.state}`;
      return;
    }
    if (message.type === "frame") {
      let out = message.key ? "\x1b[0m\x1b[2J" : "";
      for (const [row, text] of message.lines) out += `\x1b[${row + 1};1H\x1b[0m\x1b[2K${text}`;
      out += `\x1b[${message.cursor.y + 1};${message.cursor.x + 1}H${message.cursor.visible ? "\x1b[?25h" : "\x1b[?25l"}`;
      process.stdout.write(out);
    }
  });
  socket.on("close", () => process.stdout.write("\r\nponte desconectada\r\n"));
});
