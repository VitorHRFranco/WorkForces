import { readFileSync } from "node:fs";
import { createServer as createHttpsServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type ClientOptions } from "ws";
import { fetchAnchor, officeFetch, pinOfCertificate, socketTls } from "../src/net/pinned.js";

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/tls/${name}`, import.meta.url)), "utf8");
const [A, B] = [fixture("a.crt"), fixture("b.crt")];
const [KEY_A] = [fixture("a.key")];

const servers: Server[] = [];
const sockets: WebSocketServer[] = [];

/** Escritório de mentira com o certificado A (só em 127.0.0.1). */
async function office(anchorBody: string = JSON.stringify({ anchor: A })): Promise<{ url: string; server: Server }> {
  const server = createHttpsServer({ key: KEY_A, cert: A }, (req, res) => {
    if (req.url === "/api/tls/anchor") res.writeHead(200, { "content-type": "application/json" }).end(anchorBody);
    else if (req.url === "/api/health") res.writeHead(200).end("ok");
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

afterEach(async () => {
  for (const wss of sockets.splice(0)) {
    for (const c of wss.clients) c.terminate();
    wss.close();
  }
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); })));
});

describe("fetchAnchor", () => {
  it("com o pino certo devolve a âncora", async () => {
    const { url } = await office();
    const result = await fetchAnchor(url, pinOfCertificate(A));
    expect(result).toEqual({ ok: true, anchor: A });
    expect(pinOfCertificate((result as { anchor: string }).anchor)).toBe(pinOfCertificate(A));
  });

  it("com outro pino dá mismatch", async () => {
    const { url } = await office();
    expect(await fetchAnchor(url, pinOfCertificate(B))).toEqual({ ok: false, error: "mismatch" });
  });

  it("porta fechada, resposta que não é JSON e PEM ilegível dão unreachable", async () => {
    const { url, server } = await office("isto não é json");
    expect(await fetchAnchor(url, pinOfCertificate(A))).toEqual({ ok: false, error: "unreachable" });
    const bad = await office(JSON.stringify({ anchor: "-----BEGIN CERTIFICATE-----\nlixo\n-----END CERTIFICATE-----\n" }));
    expect(await fetchAnchor(bad.url, pinOfCertificate(A))).toEqual({ ok: false, error: "unreachable" });
    await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    expect(await fetchAnchor(url, pinOfCertificate(A), 1_000)).toEqual({ ok: false, error: "unreachable" });
  });
});

describe("officeFetch", () => {
  it("com a âncora certa responde, mesmo pedido por 127.0.0.1 (o nome do certificado é outro)", async () => {
    const { url } = await office();
    expect((await officeFetch(A)(`${url}/api/health`)).status).toBe(200);
  });

  it("com a âncora de outro certificado, ou sem âncora, lança erro de certificado", async () => {
    const { url } = await office();
    for (const anchor of [B, null]) {
      const error = await officeFetch(anchor)(`${url}/api/health`).then(() => null, (e: { cause?: { code?: string } }) => e);
      expect(error, String(anchor)).not.toBeNull();
      expect(error?.cause?.code, String(anchor)).toMatch(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/);
    }
  });
});

describe("socketTls", () => {
  async function wssOffice(): Promise<string> {
    const { url, server } = await office();
    sockets.push(new WebSocketServer({ server }));
    return url.replace("https", "wss");
  }
  const connects = (url: string, anchor: string): Promise<boolean> =>
    new Promise((resolve) => {
      const ws = new WebSocket(url, socketTls(anchor) as ClientOptions);
      ws.on("open", () => { ws.terminate(); resolve(true); });
      ws.on("error", () => resolve(false));
    });

  it("com a âncora certa conecta; com a de outro certificado, não", async () => {
    const url = await wssOffice();
    expect(await connects(url, A)).toBe(true);
    expect(await connects(url, B)).toBe(false);
  });

  it("sem âncora não muda as opções", () => {
    expect(socketTls(null)).toEqual({});
  });
});
