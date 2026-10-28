import type { AppBridge, SocketEvent } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { IpcSocket } from "../src/office/ipc-socket";

type BridgeSocket = AppBridge["socket"];

class FakeBridgeSocket implements BridgeSocket {
  readonly opened: number[] = [];
  readonly sent: [number, string][] = [];
  readonly closed: [number, number][] = [];
  private readonly listeners = new Set<(id: number, event: SocketEvent) => void>();
  open(id: number) { this.opened.push(id); }
  send(id: number, text: string) { this.sent.push([id, text]); }
  close(id: number, code: number) { this.closed.push([id, code]); }
  onEvent(listener: (id: number, event: SocketEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  emit(id: number, event: SocketEvent) { for (const listener of [...this.listeners]) listener(id, event); }
  get listening() { return this.listeners.size; }
}

describe("IpcSocket", () => {
  it("abre com um id próprio e só ouve os eventos dele", () => {
    const fake = new FakeBridgeSocket();
    const a = new IpcSocket(fake);
    const b = new IpcSocket(fake);
    expect(fake.opened).toEqual([a.id, b.id]);
    expect(a.id).not.toBe(b.id);
    const got: string[] = [];
    a.onmessage = (event) => got.push(event.data);
    fake.emit(b.id, { type: "message", data: "da outra" });
    fake.emit(a.id, { type: "message", data: "minha" });
    expect(got).toEqual(["minha"]);
  });

  it("manda só depois de aberto; ao fechar, avisa uma vez e para de ouvir", () => {
    const fake = new FakeBridgeSocket();
    const socket = new IpcSocket(fake);
    const closes: number[] = [];
    socket.onclose = (event) => closes.push(event.code);
    socket.send("cedo");
    expect(fake.sent).toEqual([]);
    fake.emit(socket.id, { type: "open" });
    expect(socket.readyState).toBe(1);
    socket.send("agora");
    expect(fake.sent).toEqual([[socket.id, "agora"]]);
    const before = fake.listening;
    fake.emit(socket.id, { type: "close", code: 1006 });
    expect(closes).toEqual([1006]);
    expect(socket.readyState).toBe(3);
    expect(fake.listening).toBe(before - 1);
    socket.close();
    expect(fake.closed).toEqual([]);
  });

  it("close() pede o fechamento com o código", () => {
    const fake = new FakeBridgeSocket();
    const socket = new IpcSocket(fake);
    socket.close(1000);
    expect(fake.closed).toEqual([[socket.id, 1000]]);
    expect(socket.readyState).toBe(2);
  });
});
