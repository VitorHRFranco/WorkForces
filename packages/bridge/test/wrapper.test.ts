import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFrame, AgentToServer } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { resolveClaude, type ResolvedCommand } from "../src/claude/resolve.js";
import { runDirect, runInPty, shouldUsePty, type Connector } from "../src/claude/wrapper.js";
import { BUILTIN_PATTERNS } from "../src/masking/patterns.js";
import { AgentConnection, type AgentLink } from "../src/net/agent-connection.js";
import { stripAnsi } from "./helpers/ansi.js";
import { fakeIO } from "./helpers/fake-io.js";
import { sleep, waitUntil } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const fakeCommand = (...args: string[]): ResolvedCommand => ({ file: process.execPath, args: [FAKE, ...args], viaCmd: false });

function run(command: ResolvedCommand, connect: Connector | null, agentId = randomUUID(), log?: (message: string) => void) {
  const fake = fakeIO();
  const done = runInPty({ command, cwd: process.cwd(), env: process.env, io: fake.io, agentId, patterns: BUILTIN_PATTERNS, connect, log });
  return { fake, done, agentId };
}

function realConnector(url: string, logs: string[] = []): Connector {
  return (size, events) => {
    const connection = new AgentConnection({
      url,
      token: "wf_teste",
      hello: { agentId: randomUUID(), label: "teste", ...size },
      log: (message) => logs.push(message),
      handlers: { ...events, onFatal: () => {} },
    });
    connection.start();
    return connection;
  };
}

describe("runInPty", () => {
  it("repassa saída, entrada e código de saída, e expõe WORKFORCES_AGENT_ID", async () => {
    const { fake, done, agentId } = run(fakeCommand("um arg", "dois"), null);
    await fake.waitFor("OLÁ_DO_FALSO");
    await fake.waitFor("args=um_arg|dois");
    await fake.waitFor(`agent=${agentId}`);
    fake.type("oi\r");
    await fake.waitFor("eco:oi");
    fake.type("sair\r");
    expect(await done).toBe(7);
    expect(fake.errors()).toBe("");
  });

  it("espelha a tela mascarada quando há visitante", async () => {
    const sent: AgentToServer[] = [];
    const link: AgentLink = {
      send: (message) => {
        sent.push(message);
        return true;
      },
      updateSize: () => {},
      close: () => {},
    };
    const connect: Connector = (_size, events) => {
      setTimeout(() => {
        events.onOpen();
        events.onViewers(1);
      }, 0);
      return link;
    };
    const { fake, done } = run(fakeCommand(), connect);
    const screenText = () =>
      sent
        .filter((m): m is AgentFrame => m.type === "frame")
        .flatMap((frame) => frame.lines.map(([, text]) => stripAnsi(text)))
        .join("\n");
    await waitUntil(() => screenText().includes("OLÁ_DO_FALSO"), 15_000, "quadro com o texto");
    expect(screenText()).toContain("token=" + "•".repeat(40));
    expect(screenText()).not.toContain("ghp_");
    fake.type("sair\r");
    expect(await done).toBe(7);
  });

  it("nada que vem da rede chega ao PTY", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(wss, "listening");
    wss.on("connection", (socket) => {
      socket.send("sair\r");
      socket.send(JSON.stringify({ type: "input", data: "sair\r" }));
      socket.send(JSON.stringify({ type: "viewers", n: 1 }));
    });
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/bridge`;
    const logs: string[] = [];
    const { fake, done } = run(fakeCommand(), realConnector(url, logs));
    await fake.waitFor("OLÁ_DO_FALSO");
    await waitUntil(() => logs.filter((line) => line.includes("inválida")).length >= 2, 15_000, "mensagens recebidas do servidor");
    const early = await Promise.race([done.then(() => "saiu"), sleep(1500).then(() => "vivo")]);
    expect(early).toBe("vivo");
    fake.type("sair\r");
    expect(await done).toBe(7);
    wss.close();
  });

  it("servidor fora do ar não atrapalha o Claude nem escreve no terminal", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(wss, "listening");
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/bridge`;
    wss.close();
    const { fake, done } = run(fakeCommand(), realConnector(url));
    await fake.waitFor("OLÁ_DO_FALSO");
    fake.type("sair\r");
    expect(await done).toBe(7);
    expect(fake.errors()).toBe("");
    expect(fake.output()).not.toContain("escritorio:");
  });

  it("redimensionar logo depois que o Claude sai não derruba o invólucro", async () => {
    const { fake, done } = run(fakeCommand(), null);
    await fake.waitFor("OLÁ_DO_FALSO");
    fake.type("sair\r");
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    const timer = setInterval(() => {
      if (finished) clearInterval(timer);
      else fake.io.stdout.emit("resize");
    }, 50);
    try {
      expect(await done).toBe(7);
    } finally {
      clearInterval(timer);
    }
  });

  it("falha ao criar a conexão não deixa o Claude órfão", async () => {
    const logs: string[] = [];
    const connect: Connector = () => {
      throw new Error("token ruim");
    };
    const { fake, done } = run(fakeCommand(), connect, randomUUID(), (message) => logs.push(message));
    await fake.waitFor("OLÁ_DO_FALSO");
    fake.type("sair\r");
    expect(await done).toBe(7);
    expect(logs.some((line) => line.includes("não consegui conectar ao escritório: token ruim"))).toBe(true);
  });

  it.runIf(process.platform === "win32")("roda um claude.cmd numa pasta com espaços", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf cmd "));
    writeFileSync(join(dir, "claude.cmd"), `@"${process.execPath}" "${FAKE}" %*\r\n`);
    const resolved = resolveClaude(["um arg", "dois"], { env: { PATH: dir, PATHEXT: ".EXE;.CMD" }, platform: "win32" });
    expect(resolved?.viaCmd).toBe(true);
    const { fake, done } = run(resolved!, null);
    await fake.waitFor("args=um_arg|dois");
    fake.type("sair\r");
    expect(await done).toBe(7);
  });
});

describe("runDirect e shouldUsePty", () => {
  it("roda sem PTY e repassa o código de saída", async () => {
    expect(await runDirect(fakeCommand("--once"), process.cwd(), process.env)).toBe(5);
  });

  it("só usa PTY quando stdin e stdout são terminal", () => {
    expect(shouldUsePty({ stdin: { isTTY: true }, stdout: { isTTY: true } })).toBe(true);
    expect(shouldUsePty({ stdin: { isTTY: true }, stdout: {} })).toBe(false);
    expect(shouldUsePty({ stdin: {}, stdout: { isTTY: true } })).toBe(false);
  });
});
