import { describe, expect, it } from "vitest";
import { INTERPOLATION_DELAY_MS, Track } from "../src/game/track";

describe("Track", () => {
  it("desenha o outro jogador 100 ms atrás, interpolando entre as posições recebidas", () => {
    const track = new Track();
    expect(track.at(1000)).toBeNull();
    track.push(1000, 0, 0);
    track.push(1100, 10, 20);
    expect(track.at(1000 + INTERPOLATION_DELAY_MS)).toEqual({ x: 0, y: 0 });
    expect(track.at(1050 + INTERPOLATION_DELAY_MS)).toEqual({ x: 5, y: 10 });
    expect(track.at(5000)).toEqual({ x: 10, y: 20 });
    expect(track.at(0)).toEqual({ x: 0, y: 0 });
    expect(track.last()).toEqual({ x: 10, y: 20 });
  });

  it("guarda só as últimas 20 posições", () => {
    const track = new Track();
    for (let i = 0; i < 50; i++) track.push(i * 100, i, i);
    expect(track.at(0)).toEqual({ x: 30, y: 30 });
  });
});
