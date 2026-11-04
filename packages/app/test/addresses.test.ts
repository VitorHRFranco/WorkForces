import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { listAddresses, suggestAddress } from "../src/host/addresses.js";

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
});

const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: "ffff:ffff:ffff:ffff::",
  family: "IPv6",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

/** Um computador com Wi-Fi, WSL, VirtualBox, Hamachi e Tailscale, como o da Review Focus 4. */
const machine: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  "Wi-Fi": [v4("192.168.0.10"), v6("fe80::1")],
  "vEthernet (WSL)": [v4("172.20.0.1")],
  "VirtualBox Host-Only Network": [v4("192.168.56.1")],
  Hamachi: [v4("25.1.2.3")],
  Tailscale: [v4("100.101.102.103")],
  Loopback: [v4("127.0.0.1", true)],
  "Ethernet 2": [v4("169.254.10.20")],
};

describe("listAddresses", () => {
  it("lista a rede de verdade e as VPNs; virtual, interno, IPv6 e 169.254 ficam de fora", () => {
    expect(listAddresses(machine)).toEqual([
      { address: "192.168.0.10", label: "Wi-Fi · 192.168.0.10", kind: "lan" },
      { address: "25.1.2.3", label: "Hamachi · 25.1.2.3", kind: "vpn" },
      { address: "100.101.102.103", label: "Tailscale · 100.101.102.103", kind: "vpn" },
    ]);
  });

  it("VPN pelo nome ou pela faixa (25.0.0.0/8 e 100.64.0.0/10)", () => {
    const list = listAddresses({
      "Radmin VPN": [v4("26.0.0.5")],
      ZeroTier: [v4("10.147.17.4")],
      "WireGuard Tunnel": [v4("10.8.0.2")],
      "OpenVPN Wintun": [v4("10.9.0.2")],
      NordLynx: [v4("10.5.0.2")],
      "TAP-Windows Adapter": [v4("10.10.0.2")],
      "Ethernet 3": [v4("25.9.9.9")],
      "Ethernet 4": [v4("100.64.0.1")],
      "Ethernet 5": [v4("100.127.255.1")],
      "Ethernet 6": [v4("100.128.0.1")],
      Ethernet: [v4("10.0.0.7")],
    });
    expect(Object.fromEntries(list.map((info) => [info.address, info.kind]))).toEqual({
      "26.0.0.5": "vpn",
      "10.147.17.4": "vpn",
      "10.8.0.2": "vpn",
      "10.9.0.2": "vpn",
      "10.5.0.2": "vpn",
      "10.10.0.2": "vpn",
      "25.9.9.9": "vpn",
      "100.64.0.1": "vpn",
      "100.127.255.1": "vpn",
      "100.128.0.1": "lan",
      "10.0.0.7": "lan",
    });
  });

  it("adaptadores virtuais saem pelo nome", () => {
    expect(
      listAddresses({
        "vEthernet (Default Switch)": [v4("172.30.0.1")],
        "VMware Network Adapter VMnet8": [v4("192.168.80.1")],
        "Hyper-V Virtual Ethernet": [v4("172.31.0.1")],
        docker0: [v4("172.17.0.1")],
        "Bluetooth Network Connection": [v4("192.168.44.1")],
      }),
    ).toEqual([]);
  });
});

describe("suggestAddress", () => {
  it("sugere a rede local (Wi-Fi ou Ethernet) antes da VPN, mesmo listada depois", () => {
    expect(suggestAddress(listAddresses(machine))).toEqual({ address: "192.168.0.10", label: "Wi-Fi · 192.168.0.10", kind: "lan" });
    expect(suggestAddress([{ address: "25.1.2.3", label: "Hamachi · 25.1.2.3", kind: "vpn" }, { address: "192.168.0.10", label: "Wi-Fi · 192.168.0.10", kind: "lan" }])).toMatchObject({
      address: "192.168.0.10",
    });
  });

  it("só com o Hamachi, sugere ele", () => {
    expect(suggestAddress(listAddresses({ Hamachi: [v4("25.1.2.3")], Loopback: [v4("127.0.0.1", true)] }))).toEqual({
      address: "25.1.2.3",
      label: "Hamachi · 25.1.2.3",
      kind: "vpn",
    });
  });

  it("sem rede, null", () => {
    expect(suggestAddress([])).toBeNull();
  });
});
