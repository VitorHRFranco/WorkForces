import { describe, expect, it, vi } from "vitest";
import { LEGACY } from "@workforces/protocol";
import { ApiError } from "../src/api";
import { saveAppearance } from "../src/customize/save";

const appearance = LEGACY[3];
const okProfile = () => vi.fn(async () => ({ ok: true as const }));

describe("saveAppearance", () => {
  it("grava no perfil e manda ao escritório", async () => {
    const setProfile = okProfile();
    const putOffice = vi.fn(async () => {});
    expect(await saveAppearance(appearance, { setProfile, putOffice })).toBe("saved");
    expect(setProfile).toHaveBeenCalledWith(appearance);
    expect(putOffice).toHaveBeenCalledWith(appearance);
  });

  it("o escritório de versão antiga recusa (400): fica salvo no perfil", async () => {
    const setProfile = okProfile();
    const putOffice = vi.fn(async () => {
      throw new ApiError(400, "aparência inválida");
    });
    expect(await saveAppearance(appearance, { setProfile, putOffice })).toBe("office-refused");
    expect(setProfile).toHaveBeenCalledOnce();
  });

  it("um escritório de antes da aparência no servidor (404) também conta como recusa", async () => {
    const putOffice = vi.fn(async () => {
      throw new ApiError(404, "caminho não encontrado");
    });
    expect(await saveAppearance(appearance, { setProfile: okProfile(), putOffice })).toBe("office-refused");
  });

  it("outro erro do escritório (ou a rede) também deixa salvo no perfil", async () => {
    for (const error of [new ApiError(500, "erro"), new TypeError("rede")]) {
      const setProfile = okProfile();
      const putOffice = vi.fn(async () => {
        throw error;
      });
      expect(await saveAppearance(appearance, { setProfile, putOffice })).toBe("office-unreachable");
      expect(setProfile).toHaveBeenCalledOnce();
    }
  });

  it("fora de um escritório só grava o perfil", async () => {
    expect(await saveAppearance(appearance, { setProfile: okProfile(), putOffice: null })).toBe("saved");
  });

  it("o perfil recusa: não manda ao escritório", async () => {
    const putOffice = vi.fn(async () => {});
    const setProfile = vi.fn(async () => ({ ok: false as const, error: "aparência inválida" }));
    expect(await saveAppearance(appearance, { setProfile, putOffice })).toBe("invalid");
    expect(putOffice).not.toHaveBeenCalled();
  });
});
