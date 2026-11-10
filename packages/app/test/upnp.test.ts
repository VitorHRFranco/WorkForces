import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeUpnpTransport, parseSsdpResponse, type SsdpAnswer, type UpnpTransport } from "../src/host/upnp.js";
import { upnpPortMapper } from "../src/host/wan.js";

const IP1 = "urn:schemas-upnp-org:service:WANIPConnection:1";
const IP2 = "urn:schemas-upnp-org:service:WANIPConnection:2";
const PPP1 = "urn:schemas-upnp-org:service:WANPPPConnection:1";

/** Este computador tem um adaptador (não interno) na rede 127/8, a do roteador de mentira. */
const interfaces = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
  Ethernet: [{ address: "127.0.0.5", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "127.0.0.5/8" }],
});

interface Call {
  method: string;
  path: string;
  soapAction: string | null;
  contentType: string | null;
  action: string | null;
  body: string;
}
type Reply = { status: number; body: string } | "hang";

const envelope = (body: string): string =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${body}</s:Body></s:Envelope>`;
const ok = (action: string, inner = ""): Reply => ({ status: 200, body: envelope(`<u:${action}Response xmlns:u="${IP1}">${inner}</u:${action}Response>`) });
const fault = (code: number): Reply => ({
  status: 500,
  body: envelope(
    `<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>erro</errorDescription></UPnPError></detail></s:Fault>`,
  ),
});

/** A descrição de um IGD com os serviços dados, aninhados como num roteador de verdade. */
function description(services: Array<{ type: string; control: string }>, urlBase?: string): string {
  const list = services
    .map((s) => `<service><serviceType>${s.type}</serviceType><serviceId>urn:upnp-org:serviceId:WANConn</serviceId><controlURL>${s.control}</controlURL><eventSubURL>/evt</eventSubURL><SCPDURL>/scpd.xml</SCPDURL></service>`)
    .join("");
  return (
    `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>${urlBase ? `<URLBase>${urlBase}</URLBase>` : ""}` +
    `<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>` +
    `<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><serviceList>${list}</serviceList></device></deviceList></device></deviceList></device></root>`
  );
}

const defaultReply = (action: string | null): Reply =>
  action === "GetExternalIPAddress" ? ok(action, "<NewExternalIPAddress>203.0.113.7</NewExternalIPAddress>") : ok(action ?? "Desconhecida");

const servers: Server[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** O roteador de mentira em 127.0.0.1: serve a descrição em qualquer caminho e responde ao SOAP, anotando cada pedido. */
async function startRouter(
  options: { description?(origin: string): string; descPath?: string; reply?(action: string | null, count: number): Reply | undefined } = {},
) {
  const calls: Call[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const soapAction = typeof req.headers.soapaction === "string" ? req.headers.soapaction : null;
      const action = soapAction?.replace(/"/g, "").split("#")[1] ?? null;
      calls.push({ method: req.method ?? "", path: req.url ?? "", soapAction, contentType: req.headers["content-type"] ?? null, action, body });
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(options.description ? options.description(origin) : description([{ type: IP1, control: "/ctl/ip1" }]));
        return;
      }
      const count = calls.filter((call) => call.action === action).length;
      const reply = options.reply?.(action, count) ?? defaultReply(action);
      if (reply === "hang") return;
      res.writeHead(reply.status, { "Content-Type": 'text/xml; charset="utf-8"' });
      res.end(reply.body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const soapCalls = (action?: string) => calls.filter((call) => call.method === "POST" && (action === undefined || call.action === action));
  return { origin, calls, soapCalls, location: `${origin}${options.descPath ?? "/desc.xml"}` };
}

/** A busca de mentira entrega as respostas dadas; os pedidos HTTP são os de verdade. */
function transportWith(...answers: SsdpAnswer[]): UpnpTransport {
  const real = nodeUpnpTransport(interfaces);
  return {
    async *search() {
      yield* answers;
    },
    request: (url, init) => real.request(url, init),
  };
}

const mapperFor = (...answers: SsdpAnswer[]) => upnpPortMapper({ transport: transportWith(...answers), interfaces });
const at = (location: string): SsdpAnswer => ({ location, from: "127.0.0.1" });

const addArgs = (lease: number): string =>
  `<NewRemoteHost></NewRemoteHost><NewExternalPort>4600</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>4600</NewInternalPort>` +
  `<NewInternalClient>127.0.0.5</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>WorkForces</NewPortMappingDescription><NewLeaseDuration>${lease}</NewLeaseDuration>`;

describe("parseSsdpResponse", () => {
  it("lê o LOCATION sem diferenciar maiúsculas; pacote grande ou sem LOCATION não serve", () => {
    const answer = (headers: string) => Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\n${headers}ST: ${IP1}\r\n\r\n`);
    expect(parseSsdpResponse(answer("Location: http://192.168.0.1:5000/rootDesc.xml\r\n"))).toBe("http://192.168.0.1:5000/rootDesc.xml");
    expect(parseSsdpResponse(answer("LOCATION:http://192.168.0.1:5000/a.xml\r\n"))).toBe("http://192.168.0.1:5000/a.xml");
    expect(parseSsdpResponse(answer(`LOCATION: http://192.168.0.1:5000/a.xml\r\nX-PAD: ${"a".repeat(9000)}\r\n`))).toBeNull();
    expect(parseSsdpResponse(answer(""))).toBeNull();
  });
});

describe("upnpPortMapper sobre o cliente IGD", () => {
  it("IGD v1 só com WANIPConnection:1: pede a porta no controlURL e devolve o IP público", async () => {
    const router = await startRouter();
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: true, externalIp: "203.0.113.7" });
    const [add] = router.soapCalls("AddPortMapping");
    expect(add).toEqual({
      method: "POST",
      path: "/ctl/ip1",
      soapAction: `"${IP1}#AddPortMapping"`,
      contentType: 'text/xml; charset="utf-8"',
      action: "AddPortMapping",
      body: envelope(`<u:AddPortMapping xmlns:u="${IP1}">${addArgs(3600)}</u:AddPortMapping>`),
    });
  });

  it("só WANPPPConnection:1 (PPPoE): funciona", async () => {
    const router = await startRouter({ description: () => description([{ type: PPP1, control: "/ctl/ppp" }]) });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: true, externalIp: "203.0.113.7" });
    expect(router.soapCalls("AddPortMapping")[0]).toMatchObject({ path: "/ctl/ppp", soapAction: `"${PPP1}#AddPortMapping"` });
  });

  it("com WANIPConnection:2 e :1, usa o :2", async () => {
    const router = await startRouter({
      description: () => description([{ type: IP1, control: "/ctl/ip1" }, { type: IP2, control: "/ctl/ip2" }]),
    });
    expect((await mapperFor(at(router.location)).open(4600)).ok).toBe(true);
    expect(router.soapCalls("AddPortMapping")[0]).toMatchObject({ path: "/ctl/ip2", soapAction: `"${IP2}#AddPortMapping"` });
  });

  it("controlURL relativo: resolvido contra o URLBase, ou contra a descrição sem ele", async () => {
    const withBase = await startRouter({ description: (origin) => description([{ type: IP1, control: "ctl/ip1" }], `${origin}/base/`) });
    expect((await mapperFor(at(withBase.location)).open(4600)).ok).toBe(true);
    expect(withBase.soapCalls("AddPortMapping")[0]!.path).toBe("/base/ctl/ip1");

    const withoutBase = await startRouter({ descPath: "/igd/desc.xml", description: () => description([{ type: IP1, control: "ctl/ip1" }]) });
    expect((await mapperFor(at(withoutBase.location)).open(4600)).ok).toBe(true);
    expect(withoutBase.soapCalls("AddPortMapping")[0]!.path).toBe("/igd/ctl/ip1");
  });

  it("nenhuma resposta na busca: no-gateway", async () => {
    expect(await mapperFor().open(4600)).toEqual({ ok: false, reason: "no-gateway" });
  });

  it("resposta com location noutro host que não o de quem respondeu: ignorada, no-gateway", async () => {
    const router = await startRouter();
    expect(await mapperFor({ location: router.location, from: "127.0.0.2" }).open(4600)).toEqual({ ok: false, reason: "no-gateway" });
    expect(router.calls).toEqual([]);
  });

  it("descrição acima de 64 KiB: ignorada, no-gateway", async () => {
    const router = await startRouter({ description: () => description([{ type: IP1, control: "/ctl/ip1" }]) + `<!-- ${"x".repeat(65 * 1024)} -->` });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: false, reason: "no-gateway" });
    expect(router.soapCalls()).toEqual([]);
  });

  it("718 (a porta já é de outro aparelho): port-taken, sem DeletePortMapping", async () => {
    const router = await startRouter({ reply: (action) => (action === "AddPortMapping" ? fault(718) : undefined) });
    const mapper = mapperFor(at(router.location));
    expect(await mapper.open(4600)).toEqual({ ok: false, reason: "port-taken" });
    await mapper.close();
    expect(router.soapCalls("DeletePortMapping")).toEqual([]);
  });

  it("outro erro do roteador: refused", async () => {
    const router = await startRouter({ reply: (action) => (action === "AddPortMapping" ? fault(501) : undefined) });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: false, reason: "refused" });
  });

  it("725 (só concessão permanente): repete com NewLeaseDuration 0 e abre", async () => {
    const router = await startRouter({ reply: (action, count) => (action === "AddPortMapping" && count === 1 ? fault(725) : undefined) });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: true, externalIp: "203.0.113.7" });
    expect(router.soapCalls("AddPortMapping").map((call) => call.body)).toEqual([
      envelope(`<u:AddPortMapping xmlns:u="${IP1}">${addArgs(3600)}</u:AddPortMapping>`),
      envelope(`<u:AddPortMapping xmlns:u="${IP1}">${addArgs(0)}</u:AddPortMapping>`),
    ]);
  });

  it("GetExternalIPAddress que falha: porta aberta, externalIp null", async () => {
    const router = await startRouter({ reply: (action) => (action === "GetExternalIPAddress" ? fault(501) : undefined) });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: true, externalIp: null });
  });

  it("IP público que não é IPv4: externalIp null", async () => {
    const router = await startRouter({
      reply: (action) => (action === "GetExternalIPAddress" ? ok(action, "<NewExternalIPAddress>fe80::1</NewExternalIPAddress>") : undefined),
    });
    expect(await mapperFor(at(router.location)).open(4600)).toEqual({ ok: true, externalIp: null });
  });

  it("close() manda DeletePortMapping da mesma porta ao serviço usado", async () => {
    const router = await startRouter();
    const mapper = mapperFor(at(router.location));
    await mapper.open(4600);
    await mapper.close();
    expect(router.soapCalls("DeletePortMapping")).toEqual([
      expect.objectContaining({
        path: "/ctl/ip1",
        soapAction: `"${IP1}#DeletePortMapping"`,
        body: envelope(`<u:DeletePortMapping xmlns:u="${IP1}"><NewRemoteHost></NewRemoteHost><NewExternalPort>4600</NewExternalPort><NewProtocol>TCP</NewProtocol></u:DeletePortMapping>`),
      }),
    ]);
  });

  it("close() não rejeita se o roteador der erro", async () => {
    const router = await startRouter({ reply: (action) => (action === "DeletePortMapping" ? fault(714) : undefined) });
    const mapper = mapperFor(at(router.location));
    await mapper.open(4600);
    await expect(mapper.close()).resolves.toBeUndefined();
  });

  it("close() não espera mais de 3 s por um roteador que não responde", async () => {
    const router = await startRouter({ reply: (action) => (action === "DeletePortMapping" ? "hang" : undefined) });
    const mapper = mapperFor(at(router.location));
    await mapper.open(4600);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let closed = false;
    const closing = mapper.close().then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
    await closing;
  });

  it("renova a cada 30 min; com concessão permanente, não renova", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const router = await startRouter();
    const mapper = mapperFor(at(router.location));
    await mapper.open(4600);
    expect(router.soapCalls("AddPortMapping")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await vi.waitFor(() => expect(router.soapCalls("AddPortMapping")).toHaveLength(2));
    expect(router.soapCalls("AddPortMapping")[1]!.body).toBe(envelope(`<u:AddPortMapping xmlns:u="${IP1}">${addArgs(3600)}</u:AddPortMapping>`));
    await mapper.close();

    const permanent = await startRouter({ reply: (action, count) => (action === "AddPortMapping" && count === 1 ? fault(725) : undefined) });
    await mapperFor(at(permanent.location)).open(4600);
    expect(permanent.soapCalls("AddPortMapping")).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(permanent.soapCalls("AddPortMapping")).toHaveLength(2);
  });
});
