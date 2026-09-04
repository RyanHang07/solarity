import { describe, expect, it } from "vitest";
import { buildGalaxySnapshot } from "./buildSnapshot";
import { SELF_SYSTEM_ID, onlySystem, singleSystemSnapshot } from "./singleSystem";
import type { PlanetConfig } from "./types";

const planet = (id: string): PlanetConfig => ({
  id,
  color: 0x1ec8ff,
  radius: 12,
  orbitRadius: 120,
  orbitSpeed: 0.2,
  phase: 0,
  shine: false,
});

describe("singleSystemSnapshot", () => {
  it("puts the sun and planets in exactly one system", () => {
    const snapshot = singleSystemSnapshot({
      sun: { color: 0xffcc00, radius: 28 },
      planets: [planet("a"), planet("b")],
      stars: [],
    });

    expect(snapshot.systems).toHaveLength(1);
    expect(onlySystem(snapshot).id).toBe(SELF_SYSTEM_ID);
    expect(onlySystem(snapshot).planets.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps the sky fields on the sky", () => {
    /**
     * **The half of the split that is easy to get wrong**, because `stars` and
     * `nebula` read like properties of the person who earned them. They are
     * canvas-level: `placeAchievementStars` returns coordinates in `0..1` of
     * the whole canvas, so a star cannot belong to a system without being
     * redefined.
     */
    const snapshot = singleSystemSnapshot({
      sun: { color: 0xffcc00, radius: 28 },
      planets: [],
      stars: [{ x: 0.2, y: 0.4, size: 1, twinkle: 0.2, seed: 3, color: 0xfff }],
      nebula: { colors: [0x123456], alpha: 0.3 },
      achievementCount: 7,
      nebulaPreview: true,
    });

    expect(snapshot.stars).toHaveLength(1);
    expect(snapshot.nebula?.colors).toEqual([0x123456]);
    expect(snapshot.achievementCount).toBe(7);
    expect(snapshot.nebulaPreview).toBe(true);
    expect(onlySystem(snapshot)).not.toHaveProperty("stars");
  });

  it("carries dayClosed to both the system and the sky", () => {
    // One person's closed day *is* the whole sky closing, when they are the
    // only person in it. The two stop being the same thing in a Circle, which
    // is why they are separate fields rather than one.
    const closed = singleSystemSnapshot({
      sun: { color: 0xffcc00, radius: 28 },
      planets: [],
      stars: [],
      dayClosed: true,
    });

    expect(onlySystem(closed).dayClosed).toBe(true);
    expect(closed.skyClosed).toBe(true);
  });
});

describe("onlySystem", () => {
  it("throws rather than returning undefined for an empty sky", () => {
    /**
     * **Loud on purpose.** Every caller is code that only makes sense for a
     * personal galaxy. A silent `undefined` there becomes a blank canvas
     * several frames later with nothing to explain it, which is the most
     * expensive kind of failure this codebase keeps rediscovering.
     */
    expect(() => onlySystem({ systems: [], stars: [] })).toThrow(
      /no systems/,
    );
  });
});

describe("buildGalaxySnapshot", () => {
  it("produces the one-element case rather than assembling it by hand", () => {
    // The property the whole v2 split rests on: the personal galaxy is not a
    // special path, it is `systems.length === 1`.
    const snapshot = buildGalaxySnapshot({
      goals: [{ id: "focus", categorySlug: "productivity", shine: true }],
      achievements: [],
      cosmetics: {},
    });

    expect(snapshot.systems).toHaveLength(1);
    expect(onlySystem(snapshot).id).toBe(SELF_SYSTEM_ID);
    expect(onlySystem(snapshot).planets).toHaveLength(1);
  });
});
