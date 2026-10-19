import { describe, expect, it } from "vitest";
import { MoveSender, type MoveState } from "../src/game/move-sender";

function setup() {
  const clock = { now: 0 };
  const sent: MoveState[] = [];
  const sender = new MoveSender((state) => sent.push(state), () => clock.now);
  return { clock, sent, sender };
}
const at = (x: number, moving = true): MoveState => ({ x, y: 10, dir: "right", moving });

describe("MoveSender", () => {
  it("manda no máximo a cada 100 ms enquanto anda e uma vez ao parar", () => {
    const { clock, sent, sender } = setup();
    for (let t = 0; t <= 250; t += 16) {
      clock.now = t;
      sender.update(at(t));
    }
    expect(sent.map((state) => state.x)).toEqual([0, 112, 224]);
    clock.now = 260;
    sender.update(at(260, false));
    expect(sent.at(-1)).toEqual(at(260, false));
    clock.now = 270;
    sender.update(at(260, false));
    expect(sent).toHaveLength(4);
  });

  it("flush manda o que estiver pendente na hora; resend repete a última posição", () => {
    const { clock, sent, sender } = setup();
    sender.update(at(0));
    clock.now = 30;
    sender.update(at(5));
    expect(sent).toHaveLength(1);
    sender.flush();
    expect(sent.at(-1)).toEqual(at(5));
    sender.flush();
    expect(sent).toHaveLength(2);
    sender.resend();
    expect(sent).toHaveLength(3);
    expect(sent.at(-1)).toEqual(at(5));
  });
});
