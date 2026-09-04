// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { installCanvas2dStub } from "../test/canvas2d-stub";
import {
  CONVERGENCE_MAX,
  clearSkyBridges,
  convergenceAt,
  createSkyBridges,
  paintSkyBridges,
  type BridgeAnchor,
} from "./SkyBridges";

beforeAll(() => {
  installCanvas2dStub();
});

const anchors = (count: number): BridgeAnchor[] =>
  Array.from({ length: count }, (_, i) => ({
    x: 100 + i * 30,
    y: 40 * i,
    color: 0xffcc00,
  }));

describe("sky bridges", () => {
  it("draws nothing before the moment starts", () => {
    const bridges = createSkyBridges();
    paintSkyBridges(bridges, anchors(4), 0);
    expect(bridges.visible).toBe(false);
  });

  /**
   * **Nothing happens for a Circle of one.** A lone member closing their day
   * already has a moment — the sun's own swell — and a bridge to nobody is a
   * line from a point to itself.
   */
  it("draws nothing for fewer than two members", () => {
    const bridges = createSkyBridges();
    paintSkyBridges(bridges, anchors(1), 0.5);
    expect(bridges.visible).toBe(false);
  });

  it("appears once the moment is under way", () => {
    const bridges = createSkyBridges();
    paintSkyBridges(bridges, anchors(4), 0.5);
    expect(bridges.visible).toBe(true);
  });

  it("clears back to nothing", () => {
    const bridges = createSkyBridges();
    paintSkyBridges(bridges, anchors(4), 0.5);
    clearSkyBridges(bridges);
    expect(bridges.visible).toBe(false);
  });

  it("adds nothing to the scene while idle", () => {
    // The one effect that touches every member at once, so a Circle sitting
    // still must not pay for it.
    const bridges = createSkyBridges();
    expect(bridges.visible).toBe(false);
  });
});

describe("convergence", () => {
  /**
   * **The Circle gathers and releases.** It has to end exactly where it
   * started, or a day that closes leaves the layout permanently shifted and a
   * member is no longer where they were.
   */
  it("starts and ends at nothing", () => {
    expect(convergenceAt(0)).toBe(0);
    expect(convergenceAt(1)).toBe(0);
  });

  it("peaks in the middle", () => {
    expect(convergenceAt(0.5)).toBeGreaterThan(convergenceAt(0.2));
    expect(convergenceAt(0.5)).toBeGreaterThan(convergenceAt(0.8));
  });

  /**
   * **Small on purpose.** Enough to feel like a gathering, not enough to look
   * like the layout broke — and the layout is the one thing in this scene that
   * has to stay trustworthy, because a member's position is how you find them.
   */
  it("never moves a system far", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      expect(convergenceAt(t)).toBeLessThanOrEqual(CONVERGENCE_MAX);
    }
    expect(CONVERGENCE_MAX).toBeLessThan(0.2);
  });
});
