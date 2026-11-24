import { describe, expect, it, vi } from "vitest";
import type { Rgba } from "../src/game/compose";
import { PartLoader } from "../src/game/part-loader";

const image = (): Rgba => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });

describe("PartLoader", () => {
  it("lê cada peça uma vez, mesmo com pedidos ao mesmo tempo", async () => {
    const decode = vi.fn(async () => image());
    const loader = new PartLoader(decode);
    const [a, b] = await Promise.all([loader.load("a.png"), loader.load("a.png")]);
    expect(a).toBe(b);
    expect(decode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith("/sprites/parts/a.png");
    await loader.load("b.png");
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("uma leitura que falha não fica guardada: a próxima tenta de novo", async () => {
    const decode = vi.fn(async () => image()).mockRejectedValueOnce(new Error("falhou"));
    const loader = new PartLoader(decode);
    await expect(loader.load("a.png")).rejects.toThrow("falhou");
    await expect(loader.load("a.png")).resolves.toBeTruthy();
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
