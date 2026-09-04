import { describe, expect, it } from "vitest";
import {
  CLUSTER_MIN_SYSTEM_SCALE,
  clusterReach,
  clusterRingLegibility,
  clusterSlot,
  clusterSlots,
  clusterSystemScale,
} from "./clusterLayout";

describe("clusterSlot: a joining member must not move anybody", () => {
  /**
   * **The assertion the whole layout exists for.** A Circle that rearranges
   * itself when somebody accepts an invite looks broken even though nothing is
   * wrong, and it throws away the viewer's memory of who sits where.
   *
   * Asserted as a property rather than against fixed coordinates: what matters
   * is that position `k` depends only on `k`, not what the numbers happen to be.
   */
  it("gives the same slot for the same index at every Circle size", () => {
    const two = clusterSlots(2, 100);
    const three = clusterSlots(3, 100);
    const ten = clusterSlots(10, 100);

    expect(three.slice(0, 2)).toEqual(two);
    expect(ten.slice(0, 3)).toEqual(three);
  });

  it("puts the first member at the centre", () => {
    expect(clusterSlot(0, 100)).toEqual({ x: 0, y: 0, distance: 0 });
  });

  it("never places two members on top of each other", () => {
    const slots = clusterSlots(10, 100);
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = slots[i];
        const b = slots[j];
        if (!a || !b) {
          throw new Error("missing slot");
        }
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        expect(gap, `members ${i} and ${j} overlap`).toBeGreaterThan(40);
      }
    }
  });

  it("spreads outward rather than piling up at one radius", () => {
    const slots = clusterSlots(10, 100);
    const distances = slots.map((slot) => slot.distance);
    expect(distances[9]).toBeGreaterThan(distances[1] ?? 0);
    // √k growth, not linear: the tenth is about three times the second, not ten.
    expect(distances[9]).toBeLessThan((distances[1] ?? 0) * 5);
  });

  it("handles a Circle of nobody", () => {
    expect(clusterSlots(0, 100)).toEqual([]);
  });
});

describe("clusterSystemScale", () => {
  /**
   * **A personal galaxy must be pixel-for-pixel what it always was.** The whole
   * v2 split rests on `systems.length === 1` being the ordinary case rather
   * than a special one, and a solo galaxy quietly rendered at "cluster of one"
   * scale would be the first place that claim broke.
   */
  it("does not shrink a galaxy with one system", () => {
    expect(clusterSystemScale(1)).toBe(1);
    expect(clusterSystemScale(0)).toBe(1);
  });

  it("shrinks as members are added, and never below the floor", () => {
    expect(clusterSystemScale(4)).toBeLessThan(clusterSystemScale(2));
    expect(clusterSystemScale(10)).toBeLessThan(clusterSystemScale(4));
    expect(clusterSystemScale(200)).toBe(CLUSTER_MIN_SYSTEM_SCALE);
  });

  it("keeps ten members readable rather than at the floor", () => {
    // Ten is the Circle cap, so it is the size that has to look right.
    expect(clusterSystemScale(10)).toBeGreaterThan(CLUSTER_MIN_SYSTEM_SCALE);
  });
});

describe("clusterReach", () => {
  it("frames the furthest edge, not the sum and not the biggest system", () => {
    /**
     * A member with ten goals sitting near the middle must not push everybody
     * off screen, and a distant member with one goal must not be cropped.
     */
    const reach = clusterReach(
      [
        { slotDistance: 0, reach: 400 },
        { slotDistance: 300, reach: 100 },
      ],
      0.5,
    );
    // Furthest edge is 300 + 100·0.5 = 350, not 0 + 400·0.5 = 200.
    expect(reach).toBe(350);
  });

  it("is zero for an empty sky rather than NaN", () => {
    expect(clusterReach([], 1)).toBe(0);
  });
});

describe("clusterRingLegibility", () => {
  it("leaves a single system's rings alone", () => {
    expect(clusterRingLegibility(1)).toBe(1);
  });

  it("dims and thins as the Circle grows, with a floor", () => {
    expect(clusterRingLegibility(10)).toBeLessThan(clusterRingLegibility(2));
    expect(clusterRingLegibility(500)).toBeGreaterThanOrEqual(0.35);
  });
});
