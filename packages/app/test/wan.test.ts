import type { NetworkInterfaceInfo } from "node:os";
import type { Gateway, PortMapping } from "@achingbrain/nat-port-mapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIp, isWanAddress, localAddressFor, upnpPortMapper } from "../src/host/wan.js";

const v4 = (address: string, netmask: string): NetworkInterfaceInfo => ({
  address,
  netmask,
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: null,
});

/** Wi-Fi na rede do roteador e Hamachi numa rede só dele. */
const machine: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  Hamachi: [v4("25.1.2.3", "255.0.0.0")],
  "Wi-Fi": [v4("192.168.0.10", "255.255.255.0")],
};

/** Um roteador de mentira: só o que o `upnpPortMapper` usa, com o resto do `Gateway` respondendo nada. */
function gateway(overrides: Partial<Gateway> = {}) {
  const mapped = (port: number): PortMapping => ({ externalHost: "203.0.113.7", externalPort: port, internalHost: "192.168.0.10", internalPort: port, protocol: "TCP" });
  return {
    id: "uuid:roteador",
    host: "192.168.0.1",
    port: 5000,
    family: "IPv4" as const,
    map: vi.fn(async (port: number) => mapped(port)),
    unmap: vi.fn(async () => {}),
    externalIp: vi.fn(async () => "203.0.113.7"),
    stop: vi.fn(async () => {}),
    mapAll: vi.fn(async function* () {}),
    ...overrides,
  } satisfies Gateway;
}

/** O `nat` falso: a busca devolve os roteadores dados, na ordem. */
function natWith(...gateways: Gateway[]) {
  const findGateways = vi.fn(async function* (_options?: { signal?: AbortSignal }) {
    yield* gateways;
  });
  return { nat: () => ({ findGateways }), findGateways };
}

const mapperWith = (...gateways: Gateway[]) => upnpPortMapper({ nat: natWith(...gateways).nat, interfaces: () => machine });

afterEach(() => {
  vi.useRealTimers();
});

describe("classifyIp", () => {
  it("separa as faixas privadas, a do CGNAT e o resto", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.1.1", "127.0.0.1"]) expect(classifyIp(ip)).toBe("private");
    for (const ip of ["100.64.0.1", "100.127.255.254"]) expect(classifyIp(ip)).toBe("cgnat");
    for (const ip of ["100.128.0.1", "203.0.113.7"]) expect(classifyIp(ip)).toBe("public");
  });
});

describe("localAddressFor", () => {
  it("acha o adaptador na rede do roteador; fora de todas as redes, null", () => {
    expect(localAddressFor("192.168.0.1", machine)).toBe("192.168.0.10");
    expect(localAddressFor("10.0.0.1", machine)).toBeNull();
  });
});

describe("isWanAddress", () => {
  it("aceita IP ou nome com ponto; recusa esquema, porta, nome sem ponto, IP impossível e espaço", () => {
    for (const text of ["203.0.113.7", "escritorio.ddns.net"]) expect(isWanAddress(text)).toBe(true);
    for (const text of ["https://x.y", "x.y:4600", "localhost", "999.1.1.1", "a b.c"]) expect(isWanAddress(text)).toBe(false);
  });
});

describe("upnpPortMapper", () => {
  it("sem roteador na busca: no-gateway", async () => {
    expect(await mapperWith().open(4600)).toEqual({ ok: false, reason: "no-gateway" });
  });

  it("o roteador recusou: refused", async () => {
    const router = gateway({ map: vi.fn(async () => Promise.reject(new Error("Code 718 - ConflictInMappingEntry"))) });
    expect(await mapperWith(router).open(4600)).toEqual({ ok: false, reason: "refused" });
  });

  it("o roteador deu outra porta: port-taken, e a que ele abriu é desfeita", async () => {
    const router = gateway({ map: vi.fn(async (port: number) => ({ externalHost: "203.0.113.7", externalPort: port + 1, internalHost: "192.168.0.10", internalPort: port, protocol: "TCP" as const })) });
    expect(await mapperWith(router).open(4600)).toEqual({ ok: false, reason: "port-taken" });
    expect(router.unmap).toHaveBeenCalledWith(4600, expect.anything());
  });

  it("porta aberta: devolve o IP público que o roteador informa", async () => {
    expect(await mapperWith(gateway()).open(4600)).toEqual({ ok: true, externalIp: "203.0.113.7" });
  });

  it("porta aberta, mas o roteador não diz o IP público: externalIp null", async () => {
    const router = gateway({ externalIp: vi.fn(async () => Promise.reject(new Error("sem resposta"))) });
    expect(await mapperWith(router).open(4600)).toEqual({ ok: true, externalIp: null });
  });

  it("pede a porta pelo IP deste computador na rede do primeiro roteador IPv4", async () => {
    const ipv6 = gateway({ family: "IPv6", host: "fe80::1" });
    const router = gateway();
    const { nat, findGateways } = natWith(ipv6, router);
    await upnpPortMapper({ nat, interfaces: () => machine }).open(4600);
    expect(findGateways).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(ipv6.map).not.toHaveBeenCalled();
    expect(router.map).toHaveBeenCalledWith(4600, "192.168.0.10", { protocol: "TCP", externalPort: 4600, signal: expect.any(AbortSignal) });
  });

  it("close() para o roteador e não rejeita mesmo se o stop lançar", async () => {
    const router = gateway({ stop: vi.fn(async () => Promise.reject(new Error("caiu"))) });
    const mapper = mapperWith(router);
    await mapper.open(4600);
    await expect(mapper.close()).resolves.toBeUndefined();
    expect(router.stop).toHaveBeenCalledTimes(1);
  });

  it("close() não espera mais de 3 s por um roteador que não responde", async () => {
    const router = gateway({ stop: vi.fn(() => new Promise<void>(() => {})) });
    const mapper = mapperWith(router);
    await mapper.open(4600);
    vi.useFakeTimers();
    let closed = false;
    const closing = mapper.close().then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
    await closing;
    expect(router.stop).toHaveBeenCalledTimes(1);
  });
});
