import type { Seat } from "@workforces/protocol";
import { describe, expect, it } from "vitest";
import { SIT_RADIUS, nearestSeat, seatAt, standSpot } from "../src/game/seating";

const seats: Seat[] = [
  { x: 100, y: 100, dir: "up" },
  { x: 120, y: 100, dir: "down" },
];

describe("assentos", () => {
  it("senta no assento mais perto, dentro do raio", () => {
    expect(nearestSeat(seats, { x: 108, y: 100 })).toEqual(seats[0]);
    expect(nearestSeat(seats, { x: 113, y: 100 })).toEqual(seats[1]);
    expect(nearestSeat(seats, { x: 100, y: 100 + SIT_RADIUS })).toEqual(seats[0]);
    expect(nearestSeat(seats, { x: 100, y: 101 + SIT_RADIUS })).toBeNull();
  });

  it("não senta onde já tem alguém (só a posição exata ocupa o assento)", () => {
    expect(nearestSeat(seats, { x: 108, y: 100 }, [{ x: 100, y: 100 }])).toEqual(seats[1]);
    expect(nearestSeat(seats, { x: 108, y: 100 }, [{ x: 100, y: 100 }, { x: 120, y: 100 }])).toBeNull();
    expect(nearestSeat(seats, { x: 108, y: 100 }, [{ x: 101, y: 100 }])).toEqual(seats[0]);
  });

  it("quem está parado no ponto exato de um assento está sentado nele", () => {
    expect(seatAt(seats, { x: 120, y: 100 })).toEqual(seats[1]);
    expect(seatAt(seats, { x: 120, y: 101 })).toBeNull();
  });

  it("quem volta no ponto do assento fica em pé a 12 px dele, fora dos móveis", () => {
    expect(standSpot({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 112 });
    const below = { x: 80, y: 100, width: 40, height: 20 };
    expect(standSpot({ x: 100, y: 100 }, [below])).toEqual({ x: 100, y: 88 });
  });
});
