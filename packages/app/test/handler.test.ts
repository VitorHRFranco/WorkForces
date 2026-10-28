import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPageHandler } from "../src/page/handler.js";
import type { ForwardTarget } from "../src/state.js";

let clientDir: string;
const target: ForwardTarget = { url: "https://escritorio.exemplo", session: "s1" };

beforeEach(() => {
  clientDir = mkdtempSync(join(tmpdir(), "wf-handler-"));
  writeFileSync(join(clientDir, "index.html"), "<html>INDEX</html>");
});

afterEach(() => rmSync(clientDir, { recursive: true, force: true }));

function setup(reply: () => Response = () => new Response("{}"), current: ForwardTarget | null = target) {
  const fetchImpl = vi.fn(async () => reply());
  const onAuth = vi.fn();
  const onUnauthorized = vi.fn();
  const handler = createPageHandler({ clientDir, target: () => current, onAuth, onUnauthorized, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { handler, fetchImpl, onAuth, onUnauthorized };
}

describe("createPageHandler", () => {
  it("/api e /map vão ao escritório; o resto é arquivo", async () => {
    const { handler, fetchImpl } = setup();
    await handler(new Request("app://workforces/api/me"));
    await handler(new Request("app://workforces/map/map.tmj"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const index = await handler(new Request("app://workforces/"));
    expect(await index.text()).toBe("<html>INDEX</html>");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sem escritório aberto dá 409", async () => {
    const { handler, fetchImpl } = setup(undefined, null);
    const res = await handler(new Request("app://workforces/api/me"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "nenhum escritório aberto" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("outro host dá 404", async () => {
    const { handler, fetchImpl } = setup();
    const res = await handler(new Request("app://outro/api/me"));
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("barra invertida nunca chega ao escritório", async () => {
    const { handler, fetchImpl } = setup();
    for (const path of ["/api\\..\\..\\x", "/api/%5c..%5cx", "/map/%5Cx"]) {
      expect((await handler(new Request(`app://workforces${path}`))).status, path).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resposta atrasada do escritório antigo não mexe na sessão do novo", async () => {
    const other: ForwardTarget = { url: "https://outro.exemplo", session: null };
    for (const late of [
      () => new Response("{}", { headers: { "set-cookie": "wf_session=tokenA; Path=/" } }),
      () => new Response("{}", { status: 401 }),
    ]) {
      let current: ForwardTarget | null = target;
      const onAuth = vi.fn();
      const onUnauthorized = vi.fn();
      const fetchImpl = (async () => {
        current = other;
        return late();
      }) as unknown as typeof fetch;
      const handler = createPageHandler({ clientDir, target: () => current, onAuth, onUnauthorized, fetchImpl });
      await handler(new Request("app://workforces/api/me"));
      expect(onAuth).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
    }
  });

  it("login e 401 chegam ao estado", async () => {
    const login = setup(() => new Response('{"name":"ana"}', { headers: { "content-type": "application/json", "set-cookie": "wf_session=tok; Path=/; HttpOnly" } }));
    await login.handler(new Request("app://workforces/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(login.onAuth).toHaveBeenCalledWith({ session: "tok", userName: "ana" });
    expect(login.onUnauthorized).not.toHaveBeenCalled();

    const expired = setup(() => new Response("{}", { status: 401 }));
    await expired.handler(new Request("app://workforces/api/me"));
    expect(expired.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(expired.onAuth).not.toHaveBeenCalled();
  });
});
