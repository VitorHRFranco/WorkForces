import { mkdtempSync, rmSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PIN_PATTERN, type EmbeddedToHost } from "@workforces/protocol";
import { createAccountServices } from "../src/accounts/index.js";
import { openDb } from "../src/db.js";
import { runEmbedded, type EmbeddedChannel } from "../src/embedded.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = netServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** true quando a porta está livre (dá para escutar nela). */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = netServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

let dir: string;
let handles: Array<{ close(): Promise<void> }>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-embedded-"));
  handles = [];
});
afterEach(async () => {
  for (const handle of handles) await handle.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

function fakeChannel() {
  const sent: EmbeddedToHost[] = [];
  let stop: () => void = () => {};
  const channel: EmbeddedChannel = { send: (message) => void sent.push(message), onStop: (listener) => void (stop = listener) };
  return { sent, channel, triggerStop: () => stop() };
}

const envFor = (port: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  WF_HOST: "127.0.0.1",
  WF_PORT: String(port),
  WF_PUBLIC_URL: `https://127.0.0.1:${port}`,
  WF_DATA_DIR: dir,
  WF_TLS: "self-signed",
  ...extra,
});

describe("runEmbedded", () => {
  it("manda ready com pino, âncora e convite, sem o código no log", async () => {
    const port = await freePort();
    const { sent, channel } = fakeChannel();
    const logs: string[] = [];
    const handle = await runEmbedded(envFor(port), channel, (message) => logs.push(message));
    expect(handle).not.toBeNull();
    handles.push(handle!);
    expect(sent).toHaveLength(1);
    const ready = sent[0]!;
    if (ready.type !== "ready") throw new Error("esperava ready");
    expect(ready.pin).toMatch(PIN_PATTERN);
    expect(ready.anchor).toContain("BEGIN CERTIFICATE");
    expect(ready.adminInvite).toBeTruthy();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(ready.adminInvite!);
  });

  it("na segunda execução, depois de criar a conta, não há convite e o pino é o mesmo", async () => {
    const port = await freePort();
    const first = fakeChannel();
    const one = await runEmbedded(envFor(port), first.channel, () => {});
    const a = first.sent[0]!;
    if (a.type !== "ready" || !a.adminInvite) throw new Error("esperava ready com convite");
    await one!.close();
    const db = openDb(join(dir, "workforces.db"));
    const accepted = await createAccountServices(db, Date.now).invites.accept(a.adminInvite, "ana", "senha-forte-123");
    expect(accepted.ok).toBe(true);
    db.close();

    const second = fakeChannel();
    const two = await runEmbedded(envFor(port), second.channel, () => {});
    handles.push(two!);
    const b = second.sent[0]!;
    if (b.type !== "ready") throw new Error("esperava ready");
    expect(b.adminInvite).toBeNull();
    expect(b.pin).toBe(a.pin);
  });

  it("porta ocupada: manda failed port-in-use e devolve null", async () => {
    const port = await freePort();
    const taken = netServer();
    await new Promise<void>((resolve) => taken.listen(port, "127.0.0.1", resolve));
    try {
      const { sent, channel } = fakeChannel();
      expect(await runEmbedded(envFor(port), channel, () => {})).toBeNull();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "failed", reason: "port-in-use" });
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  it("sem WF_TLS: failed com a mensagem exata", async () => {
    const port = await freePort();
    const { sent, channel } = fakeChannel();
    const env = envFor(port, { WF_TLS: undefined, WF_PUBLIC_URL: `http://127.0.0.1:${port}` });
    expect(await runEmbedded(env, channel, () => {})).toBeNull();
    expect(sent).toEqual([{ type: "failed", reason: "error", message: "o servidor embutido precisa de WF_TLS=self-signed" }]);
  });

  it("onStop fecha o servidor e libera a porta", async () => {
    const port = await freePort();
    const { channel, triggerStop } = fakeChannel();
    const handle = await runEmbedded(envFor(port), channel, () => {});
    handles.push(handle!);
    expect(await isFree(port)).toBe(false);
    triggerStop();
    await expect.poll(() => isFree(port), { timeout: 3000 }).toBe(true);
  });
});
