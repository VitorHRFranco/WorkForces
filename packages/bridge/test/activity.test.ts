import { describe, expect, it } from "vitest";
import { ActivityTracker } from "../src/mirror/activity.js";

describe("ActivityTracker", () => {
  it("começa parado e só avisa nas transições", () => {
    const tracker = new ActivityTracker(3000);
    expect(tracker.state).toBe("idle");
    expect(tracker.poll(0)).toBeNull();
    tracker.markChanged(1000);
    expect(tracker.poll(1000)).toBe("working");
    expect(tracker.poll(2000)).toBeNull();
    expect(tracker.poll(4001)).toBe("idle");
    expect(tracker.state).toBe("idle");
  });
});
