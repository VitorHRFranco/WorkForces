import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { classifyIp, isWanAddress, localAddressFor } from "../src/host/wan.js";

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

describe("classifyIp", () => {
  it("separa as faixas privadas, a do CGNAT e o resto", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.1.1", "127.0.0.1"]) expect(classifyIp(ip)).toBe("private");
    for (const ip of ["100.64.0.1", "100.127.255.254"]) expect(classifyIp(ip)).toBe("cgnat");
    for (const ip of ["100.128.0.1", "203.0.113.7"]) expect(classifyIp(ip)).toBe("public");
  });

  it("DS-Lite (192.0.0.0/24) é CGNAT; teste de rede (198.18/15), multicast e reservado (224/3) não são públicos", () => {
    expect(classifyIp("192.0.0.2")).toBe("cgnat");
    for (const ip of ["198.18.0.1", "198.19.255.254", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255"]) expect(classifyIp(ip)).toBe("private");
    for (const ip of ["192.0.1.1", "198.20.0.1", "223.255.255.254"]) expect(classifyIp(ip)).toBe("public");
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
