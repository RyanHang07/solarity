// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { installCanvas2dStub } from "../test/canvas2d-stub";
import { Galaxy } from "./Galaxy";
import { singleSystemSnapshot } from "../singleSystem";
import type { GalaxySnapshot, SystemConfig } from "../types";

beforeAll(() => installCanvas2dStub());

const member = (id: string): SystemConfig => ({
  id, sun: { color: 0xffcc00, radius: 28 }, planets: [],
});
const build = (snap: GalaxySnapshot) =>
  new Galaxy({ snapshot: snap, width: 600, height: 600, reducedMotion: true });

const coreOf = (g: Galaxy) => {
  const n = g.root.getChildByLabel("galactic-core", true);
  if (!(n instanceof Container)) throw new Error("no core");
  return n;
};

/**
 * **These are the tests that would have caught the last mistake.**
 *
 * Step 4e shipped "a counter-rotating nebula behind the cluster" as done. There
 * was no nebula behind the cluster: `createNebula` returns `null` without five
 * achievement colour families, and a Circle snapshot carries no stars. The
 * effect was a rotation applied to nothing, and nothing asserted that anything
 * was there to rotate.
 */
describe("galactic core in the scene", () => {
  it("is hidden for a personal galaxy", () => {
    const g = build(singleSystemSnapshot({ sun: { color: 1, radius: 28 }, planets: [], stars: [] }));
    try { expect(coreOf(g).visible).toBe(false); } finally { g.destroy(); }
  });
  it("shows for a Circle", () => {
    const g = build({ systems: [member("a"), member("b")], stars: [] });
    try { expect(coreOf(g).visible).toBe(true); } finally { g.destroy(); }
  });
  /**
   * **The colour has to follow the membership, and joining is incremental.**
   *
   * There is no rebuild to piggyback on when somebody joins, so a Circle that
   * went from warm suns to cool ones would otherwise keep its old colour until
   * something else forced a full teardown. The first version built the core
   * from `systems[0]` at rebuild time, which made a Circle's whole backdrop
   * depend on who happened to join first.
   */
  it("changes colour when the Circle's suns change", () => {
    const warm = (id: string): SystemConfig => ({
      id,
      sun: { color: 0xffc107, radius: 28 },
      planets: [],
    });
    const cool = (id: string): SystemConfig => ({
      id,
      sun: { color: 0x4da6ff, radius: 28 },
      planets: [],
    });

    const g = build({ systems: [warm("a"), warm("b")], stars: [] });
    try {
      const before = coreOf(g);
      // Three cool suns against two warm ones swings the Circle past the
      // threshold, so the blend — and therefore the core — must be rebuilt.
      g.setSnapshot({
        systems: [warm("a"), warm("b"), cool("c"), cool("d"), cool("e"), cool("f")],
        stars: [],
      });
      expect(coreOf(g), "the core kept a stale palette").not.toBe(before);
    } finally {
      g.destroy();
    }
  });

  it("does not rebuild when the blend is unchanged", () => {
    // The textures are painted into a canvas, so rebuilding is the most
    // expensive thing here — and members come and go far more often than a
    // Circle's colour actually shifts.
    const warm = (id: string): SystemConfig => ({
      id,
      sun: { color: 0xffc107, radius: 28 },
      planets: [],
    });
    const g = build({ systems: [warm("a"), warm("b")], stars: [] });
    try {
      const before = coreOf(g);
      g.setSnapshot({ systems: [warm("a"), warm("b"), warm("c")], stars: [] });
      expect(coreOf(g)).toBe(before);
    } finally {
      g.destroy();
    }
  });

  it("appears when a second member joins", () => {
    const g = build({ systems: [member("a")], stars: [] });
    try {
      expect(coreOf(g).visible).toBe(false);
      g.setSnapshot({ systems: [member("a"), member("b")], stars: [] });
      expect(coreOf(g).visible).toBe(true);
    } finally { g.destroy(); }
  });
});
