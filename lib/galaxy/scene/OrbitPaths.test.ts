import { describe, expect, it } from "vitest";
import { ORBIT_IDLE_COLOR, orbitStroke, orbitStrokeAt } from "../scene/OrbitPaths";
import { clusterRingLegibility } from "../systems/clusterLayout";

describe("orbitStroke", () => {
  it("stays gray until the planet shines", () => {
    const idle = orbitStroke({
      id: "health",
      radius: 120,
      color: 0x1ec8ff,
      shine: false,
    });
    expect(idle.color).toBe(ORBIT_IDLE_COLOR);
    const lit = orbitStroke({
      id: "health",
      radius: 120,
      color: 0x1ec8ff,
      shine: true,
    });
    expect(lit.color).toBe(0x1ec8ff);
    expect(lit.alpha).toBeGreaterThan(idle.alpha);
  });

  it("lerps from gray to category color", () => {
    const mid = orbitStrokeAt(0x1ec8ff, 0.5);
    expect(mid.color).not.toBe(ORBIT_IDLE_COLOR);
    expect(mid.color).not.toBe(0x1ec8ff);
    expect(mid.alpha).toBeGreaterThan(orbitStrokeAt(0x1ec8ff, 0).alpha);
    expect(mid.alpha).toBeLessThan(orbitStrokeAt(0x1ec8ff, 1).alpha);
  });

  it("boosts stroke width and alpha for compact layouts", () => {
    const idle = orbitStrokeAt(0x1ec8ff, 0);
    const boosted = orbitStrokeAt(0x1ec8ff, 0, 1.45);
    expect(boosted.width).toBeGreaterThan(idle.width);
    expect(boosted.alpha).toBeGreaterThan(idle.alpha);
  });

  it("keeps a ring wide enough to survive the rasteriser at ten members", () => {
    /**
     * **A sub-pixel stroke is not a faint stroke; it is an absent one.**
     *
     * The width used to be multiplied by the legibility, which at ten members
     * put it at 0.44 physical pixels — so a Circle drew suns with loose planets
     * and no orbits at all. Nothing failed: no test constrained the *weight* of
     * a ring, only its colour and its cleanup.
     *
     * Two claims, and the second is the one that mutation-tests the first: the
     * stroke never goes below a pixel, **and** a crowded Circle keeps most of a
     * solo galaxy's width, so restoring `width * legibility` fails here rather
     * than passing at 0.44.
     */
    const solo = orbitStrokeAt(0x8899ff, 0, clusterRingLegibility(1))
    const crowded = orbitStrokeAt(0x8899ff, 0, clusterRingLegibility(10))

    expect(crowded.width, "a ring thinner than a pixel is a ring nobody sees")
      .toBeGreaterThanOrEqual(0.9)
    expect(
      crowded.width / solo.width,
      "a crowded Circle lost most of its ring weight",
    ).toBeGreaterThan(0.7)

    // The dimming still has to happen somewhere, or "legibility" means nothing.
    expect(crowded.alpha, "a crowded Circle is no dimmer than a solo one")
      .toBeLessThan(solo.alpha)
  })
})
