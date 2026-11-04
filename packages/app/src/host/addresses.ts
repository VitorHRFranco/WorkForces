import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { HostAddressInfo } from "@workforces/protocol";

/** VPNs que fazem papel de rede local (o Hamachi é a mais comum entre amigos). */
const VPN_NAME = /hamachi|radmin|zerotier|tailscale|wireguard|openvpn|nordlynx|wintun|tap-windows/i;
/** Adaptadores que só ligam o computador às próprias máquinas virtuais: ninguém de fora entra por eles. */
const VIRTUAL_NAME = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|bluetooth/i;

/** 25.0.0.0/8 (Hamachi) e 100.64.0.0/10 (Tailscale e CGNAT): faixas das VPNs mesmo com outro nome de adaptador. */
function inVpnRange(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  return first === 25 || (first === 100 && second !== undefined && second >= 64 && second <= 127);
}

/** Os endereços IPv4 deste computador que alguém de fora alcança, com o nome da rede de cada um. */
export function listAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): HostAddressInfo[] {
  const list: HostAddressInfo[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || VIRTUAL_NAME.test(name)) continue;
    for (const info of infos) {
      // 169.254 é o endereço que o Windows inventa quando a rede não deu um: ninguém chega por ele.
      if (info.internal || info.family !== "IPv4" || info.address.startsWith("169.254.")) continue;
      list.push({ address: info.address, label: `${name} · ${info.address}`, kind: VPN_NAME.test(name) || inVpnRange(info.address) ? "vpn" : "lan" });
    }
  }
  return list;
}

/** O Wi-Fi ou a Ethernet antes da VPN; sem rede, null. */
export function suggestAddress(list: HostAddressInfo[]): HostAddressInfo | null {
  return list.find((info) => info.kind === "lan") ?? list[0] ?? null;
}
