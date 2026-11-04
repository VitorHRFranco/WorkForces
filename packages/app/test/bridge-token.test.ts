import { describe, expect, it } from "vitest";
import { ensureBridgeToken, tokenName } from "../src/agents/bridge-token.js";

const office = { url: "https://e.exemplo", session: "sess", bridgeToken: null as string | null, anchor: null as string | null };
interface Call { url: string; init: RequestInit }
const fake = (...answers: (Response | Error)[]) => {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { calls, impl };
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const auth = (call: Call) => (call.init.headers as Record<string, string>).authorization;

describe("ensureBridgeToken", () => {
  it("token guardado e aceito é usado sem criar outro", async () => {
    const { calls, impl } = fake(json(200, { name: "app PC-1" }));
    const result = await ensureBridgeToken({ ...office, bridgeToken: "tk" }, "app PC-1", impl);
    expect(result).toEqual({ ok: true, token: "tk", created: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://e.exemplo/api/bridge/whoami");
    expect(auth(calls[0]!)).toBe("Bearer tk");
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("token recusado (revogado) cria outro com a sessão", async () => {
    const { calls, impl } = fake(json(401, {}), json(201, { id: "1", name: "app PC-1", token: "novo" }));
    const result = await ensureBridgeToken({ ...office, bridgeToken: "velho" }, "app PC-1", impl);
    expect(result).toEqual({ ok: true, token: "novo", created: true });
    expect(auth(calls[0]!)).toBe("Bearer velho");
    for (const call of calls) {
      expect(call.init.redirect).toBe("manual");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect((calls[1]!.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(calls[1]!.url).toBe("https://e.exemplo/api/tokens");
    expect(calls[1]!.init.method).toBe("POST");
    expect(auth(calls[1]!)).toBe("Bearer sess");
    expect(calls[1]!.init.body).toBe('{"name":"app PC-1"}');
  });

  it("sem login ou sessão recusada pede para entrar", async () => {
    const none = fake();
    expect(await ensureBridgeToken({ ...office, session: null }, "app PC-1", none.impl)).toEqual({ ok: false, error: "no-office" });
    expect(none.calls).toHaveLength(0);
    const refused = fake(json(401, {}));
    expect(await ensureBridgeToken(office, "app PC-1", refused.impl)).toEqual({ ok: false, error: "no-office" });
  });

  it("escritório fora do ar", async () => {
    expect(await ensureBridgeToken(office, "app PC-1", fake(new Error("ECONNREFUSED")).impl)).toEqual({ ok: false, error: "office-down" });
    expect(await ensureBridgeToken({ ...office, bridgeToken: "tk" }, "app PC-1", fake(new Error("x")).impl)).toEqual({ ok: false, error: "office-down" });
  });

  it("outro status vira spawn-failed, e o nome é cortado em 40", async () => {
    expect(await ensureBridgeToken(office, "n", fake(json(500, {})).impl)).toEqual({ ok: false, error: "spawn-failed" });
    const redirected = new Response(null, { status: 302, headers: { location: "https://outro.exemplo" } });
    expect(await ensureBridgeToken({ ...office, bridgeToken: "tk" }, "n", fake(redirected).impl)).toEqual({ ok: false, error: "spawn-failed" });
    expect(tokenName("a".repeat(60))).toHaveLength(40);
    expect(tokenName("PC-1")).toBe("app PC-1");
  });
});
