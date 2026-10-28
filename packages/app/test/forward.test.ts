import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkReachable, forwardToOffice } from "../src/net/forward.js";

interface Seen {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}
interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

const servers: Server[] = [];

async function fakeOffice(reply: Reply = {}): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(reply.status ?? 200, reply.headers ?? {});
      res.end(reply.body ?? "");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("forwardToOffice", () => {
  it("repassa ao escritório com Bearer, só o caminho e a busca", async () => {
    const { base, seen } = await fakeOffice();
    await forwardToOffice({ url: base, session: "s1" }, new Request("app://workforces/api/me?x=1", { headers: { cookie: "a=b", origin: "app://workforces" } }));
    expect(seen[0].url).toBe("/api/me?x=1");
    expect(seen[0].headers.authorization).toBe("Bearer s1");
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.origin).toBeUndefined();
  });

  it("o Set-Cookie vira a sessão e nunca chega à página", async () => {
    const { base } = await fakeOffice({
      headers: { "content-type": "application/json", "set-cookie": "wf_session=abc%2Fd; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600" },
      body: '{"id":1,"name":"ana","isAdmin":false}',
    });
    const out = await forwardToOffice({ url: base, session: null }, new Request("app://workforces/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(out.auth).toEqual({ session: "abc/d", userName: "ana" });
    expect(out.response.headers.get("set-cookie")).toBeNull();
    expect(await out.response.json()).toMatchObject({ name: "ana" });
  });

  it("o POST leva o corpo e o content-type", async () => {
    const { base, seen } = await fakeOffice();
    await forwardToOffice({ url: base, session: "s1" }, new Request("app://workforces/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"ana"}' }));
    expect(seen[0].body).toBe('{"name":"ana"}');
    expect(seen[0].headers["content-type"]).toBe("application/json");
  });

  it("cookie apagado vira logout", async () => {
    const { base } = await fakeOffice({ headers: { "set-cookie": "wf_session=; Path=/; Max-Age=0" } });
    const out = await forwardToOffice({ url: base, session: "s1" }, new Request("app://workforces/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(out.auth).toEqual({ session: null, userName: null });
  });

  it("401 com sessão avisa que expirou; sem sessão, não", async () => {
    const { base } = await fakeOffice({ status: 401, body: "{}" });
    const withSession = await forwardToOffice({ url: base, session: "s1" }, new Request("app://workforces/api/me"));
    const without = await forwardToOffice({ url: base, session: null }, new Request("app://workforces/api/me"));
    expect(withSession.unauthorized).toBe(true);
    expect(without.unauthorized).toBe(false);
  });

  it("o pedido nunca sai do endereço do escritório", async () => {
    const target = { url: "https://escritorio.exemplo", session: "s1" };
    for (const path of ["//outro.exemplo/api/x", "/api/..%2f..%2fx", "/api/x?y=//outro.exemplo"]) {
      const called: string[] = [];
      const spy = (async (input: URL | string) => {
        called.push(String(input));
        return new Response("{}");
      }) as typeof fetch;
      await forwardToOffice(target, new Request(`app://workforces${path}`), spy);
      expect(called, path).toHaveLength(1);
      expect(new URL(called[0]).origin, path).toBe(new URL(target.url).origin);
    }
  });

  it("escritório fora do ar dá 502 com o que fazer", async () => {
    const url = await closedPort();
    const out = await forwardToOffice({ url, session: "s1" }, new Request("app://workforces/api/me"));
    expect(out.response.status).toBe(502);
    const body = (await out.response.json()) as { error: string };
    expect(body.error).toContain(new URL(url).host);
    expect(body.error).toContain("internet ou a VPN");
  });

  it("redirecionamento não é seguido", async () => {
    const other = await fakeOffice();
    const { base } = await fakeOffice({ status: 302, headers: { location: `${other.base}/api/me` } });
    const out = await forwardToOffice({ url: base, session: "s1" }, new Request("app://workforces/api/me"));
    expect(out.response.status).toBe(502);
    expect(other.seen).toHaveLength(0);
  });
});

describe("checkReachable", () => {
  it("diz se o escritório responde", async () => {
    const { base, seen } = await fakeOffice({ status: 200, body: "{}" });
    expect(await checkReachable(base)).toBe(true);
    expect(seen[0].url).toBe("/api/health");
    expect(await checkReachable(await closedPort())).toBe(false);
  });
});
