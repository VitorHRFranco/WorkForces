import { describe, expect, it, vi } from "vitest";
import { LEGACY, type Appearance } from "@workforces/protocol";
import { ApiError } from "../src/api";
import { sendProfileAppearance } from "../src/office/send-appearance";

const appearance: Appearance = LEGACY[3];

describe("sendProfileAppearance", () => {
  it("com perfil, manda a aparência uma vez", async () => {
    const put = vi.fn(async (_appearance: Appearance) => {});
    const log = vi.fn();
    await sendProfileAppearance({ get: async () => appearance, put, log });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(appearance);
    expect(log).not.toHaveBeenCalled();
  });

  it("sem perfil, não manda nada", async () => {
    const put = vi.fn(async (_appearance: Appearance) => {});
    await sendProfileAppearance({ get: async () => null, put, log: vi.fn() });
    expect(put).not.toHaveBeenCalled();
  });

  it("servidor antigo (404) não derruba a entrada: só vai ao log", async () => {
    const log = vi.fn();
    await expect(
      sendProfileAppearance({
        get: async () => appearance,
        put: async () => {
          throw new ApiError(404, "não encontrado");
        },
        log,
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("não espera mais que o prazo", async () => {
    const log = vi.fn();
    const started = performance.now();
    await sendProfileAppearance({ get: async () => appearance, put: () => new Promise<void>(() => {}), log, timeoutMs: 20 });
    expect(performance.now() - started).toBeLessThan(500);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("perfil que não abre também só vai ao log", async () => {
    const log = vi.fn();
    const put = vi.fn(async (_appearance: Appearance) => {});
    await expect(
      sendProfileAppearance({
        get: async () => {
          throw new Error("sem perfil");
        },
        put,
        log,
      }),
    ).resolves.toBeUndefined();
    expect(put).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
