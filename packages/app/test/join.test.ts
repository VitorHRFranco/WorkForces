import { describe, expect, it, vi } from "vitest";
import { prepareInvite } from "../src/offices/join.js";
import type { fetchAnchor } from "../src/net/pinned.js";

const PIN = "A".repeat(43);
const withPin = `workforces://invite?server=https%3A%2F%2F192.168.0.10%3A4600&code=abc&pin=${PIN}`;

describe("prepareInvite", () => {
  it("convite sem pino não busca âncora", async () => {
    const impl = vi.fn<typeof fetchAnchor>();
    const out = await prepareInvite("workforces://invite?server=https%3A%2F%2Fe.exemplo&code=abc", impl);
    expect(out).toEqual({ ok: true, invite: { server: "https://e.exemplo", code: "abc", pin: null }, anchor: null });
    expect(impl).not.toHaveBeenCalled();
  });

  it("com pino e âncora certa devolve a âncora", async () => {
    const impl = vi.fn<typeof fetchAnchor>(async () => ({ ok: true, anchor: "PEM" }));
    const out = await prepareInvite(withPin, impl);
    expect(out).toEqual({ ok: true, invite: { server: "https://192.168.0.10:4600", code: "abc", pin: PIN }, anchor: "PEM" });
    expect(impl).toHaveBeenCalledWith("https://192.168.0.10:4600", PIN);
  });

  it("mismatch e unreachable viram avisos", async () => {
    expect(await prepareInvite(withPin, async () => ({ ok: false, error: "mismatch" }))).toEqual({
      ok: false,
      notice: "o certificado do escritório não confere com o do convite; peça um convite novo a quem administra o escritório",
    });
    expect(await prepareInvite(withPin, async () => ({ ok: false, error: "unreachable" }))).toEqual({
      ok: false,
      notice: "não consegui falar com 192.168.0.10:4600; confira a rede (ou a VPN) e se o escritório está ligado",
    });
  });

  it("link inválido vira aviso", async () => {
    expect(await prepareInvite("lixo")).toEqual({ ok: false, notice: "isso não parece um convite do WorkForces; cole o link que você recebeu" });
  });
});
