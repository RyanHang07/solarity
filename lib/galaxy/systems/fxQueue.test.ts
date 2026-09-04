import { describe, expect, it } from "vitest";
import { FxQueue } from "./fxQueue";

const recordJob = (kind: string, log: string[]) => ({
  kind,
  duration: 100,
  update: (t: number) => {
    log.push(`${kind}:update:${t.toFixed(2)}`);
  },
  finish: () => {
    log.push(`${kind}:finish`);
  },
});

describe("FxQueue", () => {
  it("runs independent jobs on the same tick", () => {
    const queue = new FxQueue();
    const log: string[] = [];
    queue.play(recordJob("shine:a", log));
    queue.play(recordJob("day-closed", log));
    queue.tick(50);
    expect(queue.kinds()).toEqual(["shine:a", "day-closed"]);
    expect(log.some((line) => line.startsWith("shine:a:update"))).toBe(true);
    expect(log.some((line) => line.startsWith("day-closed:update"))).toBe(true);
  });

  it("cancel drops a job without calling finish", () => {
    const queue = new FxQueue();
    const log: string[] = [];
    queue.play(recordJob("shine:a", log));
    queue.play(recordJob("shine:b", log));
    queue.tick(40);
    queue.cancel("shine:a");
    queue.tick(100);
    expect(queue.kinds()).toEqual([]);
    expect(log).not.toContain("shine:a:finish");
    expect(log).toContain("shine:b:finish");
  });

  it("keeps jobs queued from a finish callback on the same tick", () => {
    const queue = new FxQueue();
    const log: string[] = [];
    queue.play({
      kind: "burst:a",
      duration: 50,
      update: () => undefined,
      finish: () => {
        log.push("burst:a:finish");
        queue.play(recordJob("orbit-refit", log));
      },
    });
    queue.tick(50);
    expect(log).toEqual(["burst:a:finish"]);
    expect(queue.kinds()).toEqual(["orbit-refit"]);
    queue.tick(100);
    expect(log).toContain("orbit-refit:finish");
  });
});
