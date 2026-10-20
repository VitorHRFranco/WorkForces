import { describe, expect, it } from "vitest";
import { cameraFrame, panelInset } from "../src/game/camera";

describe("câmera com o painel do terminal", () => {
  it("o painel cobre a direita do canvas; a câmera só desvia se sobrar mapa à vista", () => {
    expect(panelInset(1600, false)).toBe(0);
    expect(panelInset(1600, true)).toBe(772);
    expect(panelInset(1100, true)).toBe(772);
    expect(panelInset(1000, true)).toBe(0); // sobrariam 228 px
    expect(panelInset(600, true)).toBe(0);
  });

  it("com o painel aberto, o avatar vai para o meio do que sobra e o limite cresce à direita", () => {
    expect(cameraFrame(832, 0, 2)).toEqual({ boundsWidth: 832, offsetX: 0 });
    expect(cameraFrame(832, 772, 2)).toEqual({ boundsWidth: 1218, offsetX: -193 });
  });
});
