// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { Container, Graphics, Sprite } from "pixi.js";
import { installCanvas2dStub } from "../test/canvas2d-stub";
import { singleSystemSnapshot } from "../singleSystem";
import { Galaxy } from "./Galaxy";
import type {
  GalaxySnapshot,
  PlanetConfig,
  SingleSystemSnapshot,
  SystemConfig,
} from "../types";

/**
 * Characterisation tests for `Galaxy`.
 *
 * ## Why these exist, written down because the plan was wrong about it
 *
 * `docs/SNAPSHOT_V2.md` originally justified extracting `SolarSystem` first on
 * the grounds that "it is the only step where the tests fully constrain the
 * outcome". **That was false.** Nothing tested `Galaxy` or `mountGalaxy` at
 * all: the 86 tests covered pure systems and two scene helpers that happen to
 * construct without a renderer. The largest and most mechanical refactor in
 * the plan was the one with no safety net under it.
 *
 * The obstacle was never difficulty, it was `getContext("2d")` returning null
 * under jsdom — which `lib/galaxy/test/canvas2d-stub.ts` now answers. See that file
 * for what the stub can and cannot tell you.
 *
 * ## What these assert, and what they deliberately do not
 *
 * **Structure and lifetime**, because that is what an extraction can break:
 * how many planets are in the scene, whether a rebuild replaces rather than
 * accumulates, whether teardown frees what it owns. Nothing here looks at
 * appearance — with a stub context, a painter that drew nothing at all would
 * pass every test in this file. That is the device pass's job.
 */

beforeAll(() => {
  installCanvas2dStub();
});

const planet = (id: string, over: Partial<PlanetConfig> = {}): PlanetConfig => ({
  id,
  color: 0x1ec8ff,
  radius: 12,
  orbitRadius: 120,
  orbitSpeed: 0.2,
  phase: 0,
  shine: false,
  ...over,
});

/**
 * A one-person sky, built through the adapter every single-system host uses.
 *
 * **Not a hand-written `systems: [...]`.** These tests are what stands behind
 * the claim that the personal galaxy is genuinely the one-element case, and a
 * fixture that assembled the array itself would stop exercising the adapter
 * the product actually calls.
 */
const snapshot = (
  planets: PlanetConfig[],
  over: Partial<SingleSystemSnapshot> = {},
): GalaxySnapshot =>
  singleSystemSnapshot({
    sun: { color: 0xffcc00, radius: 28, growth: 0.2 },
    planets,
    stars: [],
    achievementCount: 0,
    ...over,
  });

const build = (snap: GalaxySnapshot): Galaxy =>
  new Galaxy({
    snapshot: snap,
    width: 600,
    height: 600,
    starCap: 200,
    // Off, so nothing depends on how many frames a test happens to run.
    reducedMotion: true,
  });

/**
 * The container one member's nodes live in.
 *
 * **Searched deeply, because the scene gained a tier.** Systems used to hang
 * off `root`; they now hang off `cluster`, which is what the camera transforms
 * so that one transform serves any number of members. Every assertion in this
 * file is about a system's contents rather than its depth, so the helper
 * absorbs the nesting and the tests stay about behaviour.
 */
const systemOf = (galaxy: Galaxy): Container => {
  const system = galaxy.root.getChildByLabel("system", true);
  if (!(system instanceof Container)) {
    throw new Error("no system container");
  }
  return system;
};

const planetNodes = (galaxy: Galaxy): Container[] =>
  systemOf(galaxy).children.filter(
    (child): child is Container =>
      child instanceof Container &&
      typeof child.label === "string" &&
      child.label.startsWith("planet-"),
  );

const sunOf = (galaxy: Galaxy): Container => {
  const sun = systemOf(galaxy).getChildByLabel("sun");
  if (!(sun instanceof Container)) {
    throw new Error("no sun");
  }
  return sun;
};

/** The two maps a sun generates for itself, as opposed to the shared ones. */
const sunOwnTextures = (galaxy: Galaxy) => {
  const sun = sunOf(galaxy);
  const veil = sun.getChildByLabel("sun-veil", true);
  const photosphere = sun.getChildByLabel("sun-photosphere", true);
  if (!(veil instanceof Sprite) || !(photosphere instanceof Sprite)) {
    throw new Error("sun is missing its generated sprites");
  }
  return [veil.texture, photosphere.texture];
};

describe("Galaxy: what the scene contains", () => {
  it("puts one node in the system per planet, and a sun", () => {
    const galaxy = build(snapshot([planet("a"), planet("b"), planet("c")]));
    try {
      expect(planetNodes(galaxy)).toHaveLength(3);
      expect(sunOf(galaxy)).toBeDefined();
    } finally {
      galaxy.destroy();
    }
  });

  it("renders a galaxy with no planets at all", () => {
    // A new account, and the case most likely to be forgotten in a refactor
    // that assumes `planets[0]` exists.
    const galaxy = build(snapshot([]));
    try {
      expect(planetNodes(galaxy)).toHaveLength(0);
      expect(sunOf(galaxy)).toBeDefined();
    } finally {
      galaxy.destroy();
    }
  });

  it("adds a node when a goal appears", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.setSnapshot(snapshot([planet("a"), planet("b")]));
      expect(planetNodes(galaxy).map((node) => node.label)).toContain(
        "planet-b",
      );
    } finally {
      galaxy.destroy();
    }
  });

  it("does not accumulate nodes when the same snapshot is set twice", () => {
    // The failure mode of a rebuild that adds without clearing: the scene keeps
    // working and quietly doubles.
    const galaxy = build(snapshot([planet("a"), planet("b")]));
    try {
      const snap = snapshot([planet("a"), planet("b")]);
      galaxy.setSnapshot(snap);
      galaxy.setSnapshot(snap);
      expect(planetNodes(galaxy)).toHaveLength(2);
    } finally {
      galaxy.destroy();
    }
  });

  it("keeps the node count right when a planet is replaced by a different one", () => {
    const galaxy = build(snapshot([planet("a"), planet("b")]));
    try {
      galaxy.setSnapshot(snapshot([planet("a"), planet("c")]));
      // `b` leaves through an FX, so give the queue time to finish rather than
      // asserting on the frame the change was made.
      for (let i = 0; i < 120; i += 1) {
        galaxy.tick(16);
      }
      const labels = planetNodes(galaxy).map((node) => node.label);
      expect(labels).toContain("planet-a");
      expect(labels).toContain("planet-c");
      expect(labels).not.toContain("planet-b");
    } finally {
      galaxy.destroy();
    }
  });
});

describe("Galaxy: the orbit rings track the planets", () => {
  /**
   * The ring graphics are a second collection keyed by planet id, kept in step
   * with the bodies by hand. A leftover ring draws an orbit with nothing on it.
   *
   * **Mutation-tested, and the first result was a surprise worth recording.**
   * Breaking the ring cleanup in `syncOrbitPaths` did not fail these tests.
   * Neither did breaking it in `detachPlanet`. Only breaking *both* did —
   * because the two are independently sufficient, and a removed planet has its
   * ring cleared twice by two unrelated code paths.
   *
   * That is fine as behaviour and useful to know before the extraction, which
   * will probably collapse the two. So these assert the **outcome** — no ring
   * without a planet — and deliberately not which path achieves it. A
   * characterisation test that pinned the path would fail on a refactor that
   * changed nothing a user could see.
   */
  const ringIds = (galaxy: Galaxy): string[] => {
    const paths = systemOf(galaxy).getChildByLabel("orbit-paths");
    if (!(paths instanceof Container)) {
      return [];
    }
    return paths.children
      .map((child) => child.label)
      .filter((label): label is string => typeof label === "string")
      .map((label) => label.replace("orbit-ring-", ""));
  };

  it("draws one ring per planet", () => {
    const galaxy = build(snapshot([planet("a"), planet("b")]));
    try {
      expect(ringIds(galaxy).sort()).toEqual(["a", "b"]);
    } finally {
      galaxy.destroy();
    }
  });

  it("adds a ring with a new planet and drops it with a removed one", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.setSnapshot(snapshot([planet("a"), planet("b")]));
      expect(ringIds(galaxy).sort()).toEqual(["a", "b"]);

      galaxy.setSnapshot(snapshot([planet("a")]));
      for (let i = 0; i < 120; i += 1) {
        galaxy.tick(16);
      }
      expect(ringIds(galaxy), "a ring outlived its planet").toEqual(["a"]);
    } finally {
      galaxy.destroy();
    }
  });

  it("moves a ring when only the orbit radius changed", () => {
    // The orbit-refit path, which is its own coordinator and its own FX kind.
    // Under reducedMotion it snaps rather than animating, so one tick is enough.
    const galaxy = build(snapshot([planet("a", { orbitRadius: 120 })]));
    try {
      galaxy.setSnapshot(snapshot([planet("a", { orbitRadius: 260 })]));
      galaxy.tick(16);
      expect(ringIds(galaxy)).toEqual(["a"]);
      expect(planetNodes(galaxy)).toHaveLength(1);
    } finally {
      galaxy.destroy();
    }
  });
});

describe("Galaxy: the controls the host calls", () => {
  it("adds and hides a belt without rebuilding the planet", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      const before = planetNodes(galaxy)[0];
      galaxy.setBeltVisible("a", true);
      expect(before?.getChildByLabel("belt")).toBeTruthy();
      expect(before?.getChildByLabel("belt")?.visible).toBe(true);

      galaxy.setBeltVisible("a", false);
      expect(before?.getChildByLabel("belt")?.visible).toBe(false);

      // Same node throughout: this must not be a rebuild.
      expect(planetNodes(galaxy)[0]).toBe(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("ignores a belt request for a planet that is not there", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      expect(() => galaxy.setBeltVisible("nope", true)).not.toThrow();
    } finally {
      galaxy.destroy();
    }
  });

  it("scales the sun when growth changes, without replacing it", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      const sun = sunOf(galaxy);
      const before = sun.scale.x;
      galaxy.setSunGrowth(1);
      expect(sunOf(galaxy), "the sun was rebuilt for a growth change").toBe(sun);
      expect(sun.scale.x).toBeGreaterThan(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("clamps growth to 0..1", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.setSunGrowth(9);
      const high = sunOf(galaxy).scale.x;
      galaxy.setSunGrowth(-4);
      const low = sunOf(galaxy).scale.x;
      expect(high).toBeGreaterThan(low);
    } finally {
      galaxy.destroy();
    }
  });

  it("keeps the view within the tilt limits", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.setView({ tilt: 99 });
      expect(galaxy.getView().tilt).toBeLessThan(2);
      galaxy.setView({ tilt: -99 });
      expect(galaxy.getView().tilt).toBeGreaterThan(0);
    } finally {
      galaxy.destroy();
    }
  });

  it("pans, zooms and resets the camera", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.panBy(30, -20);
      expect(galaxy.getCamera()).toMatchObject({ panX: 30, panY: -20 });

      galaxy.zoomBy(2);
      expect(galaxy.getCamera().zoom).toBeGreaterThan(1);

      galaxy.resetCamera();
      expect(galaxy.getCamera()).toEqual({ panX: 0, panY: 0, zoom: 1 });
    } finally {
      galaxy.destroy();
    }
  });

  it("clamps zoom rather than letting it run away", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      for (let i = 0; i < 50; i += 1) {
        galaxy.zoomBy(2);
      }
      const zoomedIn = galaxy.getCamera().zoom;
      for (let i = 0; i < 100; i += 1) {
        galaxy.zoomBy(0.5);
      }
      const zoomedOut = galaxy.getCamera().zoom;
      expect(zoomedIn).toBeLessThanOrEqual(2.4);
      expect(zoomedOut).toBeGreaterThanOrEqual(0.65);
    } finally {
      galaxy.destroy();
    }
  });
});

describe("Galaxy: it survives being driven", () => {
  it("ticks without a planet in the snapshot going stale", () => {
    const galaxy = build(snapshot([planet("a"), planet("b")]));
    try {
      galaxy.tick(16);
      galaxy.setSnapshot(
        snapshot([planet("a", { shine: true }), planet("b")]),
      );
      for (let i = 0; i < 10; i += 1) {
        galaxy.tick(16);
      }
      expect(planetNodes(galaxy)).toHaveLength(2);
    } finally {
      galaxy.destroy();
    }
  });

  it("relayouts to a new size", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      galaxy.layout(320, 240);
      galaxy.tick(16);
      expect(planetNodes(galaxy)).toHaveLength(1);
    } finally {
      galaxy.destroy();
    }
  });
});

describe("Galaxy: many systems in one sky", () => {
  const member = (
    id: string,
    planets: PlanetConfig[] = [],
    over: Partial<SystemConfig> = {},
  ): SystemConfig => ({
    id,
    sun: { color: 0xffcc00, radius: 28, growth: 0.2 },
    planets,
    ...over,
  });

  const circle = (
    systems: SystemConfig[],
    over: Partial<GalaxySnapshot> = {},
  ): GalaxySnapshot => ({ systems, stars: [], ...over });

  const systemNodes = (galaxy: Galaxy): Container[] => {
    const cluster = galaxy.root.getChildByLabel("cluster");
    if (!(cluster instanceof Container)) {
      throw new Error("no cluster");
    }
    return cluster.children.filter(
      (child): child is Container =>
        child instanceof Container && child.label === "system",
    );
  };

  it("builds one system node per member", () => {
    const galaxy = build(circle([member("amy"), member("ben"), member("cat")]));
    try {
      expect(systemNodes(galaxy)).toHaveLength(3);
    } finally {
      galaxy.destroy();
    }
  });

  it("places members apart rather than on top of each other", () => {
    const galaxy = build(
      circle([member("amy", [planet("a")]), member("ben", [planet("b")])]),
    );
    try {
      const [first, second] = systemNodes(galaxy);
      const gap = Math.hypot(
        (first?.x ?? 0) - (second?.x ?? 0),
        (first?.y ?? 0) - (second?.y ?? 0),
      );
      expect(gap).toBeGreaterThan(0);
    } finally {
      galaxy.destroy();
    }
  });

  it("leaves a lone member unscaled and uncentred", () => {
    // The one-element case has to stay pixel-for-pixel what it was: the whole
    // v2 split rests on a personal galaxy not being a special path.
    const galaxy = build(circle([member("amy", [planet("a")])]));
    try {
      const [only] = systemNodes(galaxy);
      expect(only?.scale.x).toBe(1);
      expect(only?.x).toBe(0);
      expect(only?.y).toBe(0);
    } finally {
      galaxy.destroy();
    }
  });

  /**
   * **No member's planets may reach another member's sun.**
   *
   * This assertion has been written twice, and the first version asked the
   * wrong question. It required whole systems not to overlap — centres at least
   * two *orbit* radii apart — which is a much stronger claim than anything the
   * picture needs, and satisfying it pushed the suns visibly too far apart.
   *
   * **Orbit ellipses crossing is fine.** They are thin and dim at cluster
   * scale, and overlapping rings read as a cluster rather than as a mistake.
   * The collision that actually looked wrong was a planet passing through
   * somebody's sun, so that is what this checks: the furthest planet of one
   * system, against the drawn radius of every other system's sun.
   */
  it("keeps every member's planets clear of every other member's sun", () => {
    const ORBIT = 320;
    // `SUN_DISPLAY_SCALE` is 1.5, and growth adds up to another 75%.
    const SUN_DRAWN = 28 * 1.5 * (1 + 0.2 * 0.75);

    for (const count of [2, 3, 5, 10]) {
      const galaxy = build(
        circle(
          Array.from({ length: count }, (_, m) =>
            member(`m${m}`, [planet(`m${m}-g`, { orbitRadius: ORBIT })]),
          ),
        ),
      );
      try {
        const nodes = systemNodes(galaxy);
        const scale = nodes[0]?.scale.x ?? 1;
        const reach = ORBIT * scale;
        const sun = SUN_DRAWN * scale;

        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            if (!a || !b) {
              throw new Error("missing system");
            }
            const centres = Math.hypot(a.x - b.x, a.y - b.y);
            expect(
              centres - reach,
              `a planet reaches ${j}'s sun in a Circle of ${count}`,
            ).toBeGreaterThan(sun);
          }
        }
      } finally {
        galaxy.destroy();
      }
    }
  });

  it("shrinks systems as the Circle grows", () => {
    const small = build(circle([member("amy"), member("ben")]));
    const large = build(
      circle(Array.from({ length: 8 }, (_, i) => member(`m${i}`))),
    );
    try {
      expect(systemNodes(large)[0]?.scale.x).toBeLessThan(
        systemNodes(small)[0]?.scale.x ?? 0,
      );
    } finally {
      small.destroy();
      large.destroy();
    }
  });

  /**
   * **A member joining must not disturb anybody.** Rebuilding the scene would
   * restart every other member's orbits from their starting phase, which reads
   * as the screen glitching because a stranger arrived.
   *
   * Asserted on node identity: the existing system objects must be the *same*
   * containers afterwards, not equivalent ones.
   */
  it("adds a joining member without rebuilding the others", () => {
    const galaxy = build(circle([member("amy", [planet("a")])]));
    try {
      const before = systemNodes(galaxy)[0];
      galaxy.setSnapshot(
        circle([member("amy", [planet("a")]), member("ben", [planet("b")])]),
      );
      const after = systemNodes(galaxy);
      expect(after).toHaveLength(2);
      expect(after[0], "amy's system was rebuilt").toBe(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("removes a departing member and leaves the rest alone", () => {
    const galaxy = build(
      circle([member("amy", [planet("a")]), member("ben", [planet("b")])]),
    );
    try {
      const before = systemNodes(galaxy)[0];
      galaxy.setSnapshot(circle([member("amy", [planet("a")])]));
      const after = systemNodes(galaxy);
      expect(after).toHaveLength(1);
      expect(after[0], "amy's system was rebuilt").toBe(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("keeps each member's planets in their own system", () => {
    const galaxy = build(
      circle([
        member("amy", [planet("a1"), planet("a2")]),
        member("ben", [planet("b1")]),
      ]),
    );
    try {
      const nodes = systemNodes(galaxy);
      const count = (node: Container | undefined): number =>
        (node?.children ?? []).filter(
          (child) =>
            typeof child.label === "string" &&
            child.label.startsWith("planet-"),
        ).length;
      expect(count(nodes[0])).toBe(2);
      expect(count(nodes[1])).toBe(1);
    } finally {
      galaxy.destroy();
    }
  });

  /**
   * **Planet ids are unique per system, not globally.** Two members holding
   * the same id must each get their own planet rather than one of them
   * silently winning.
   */
  it("keeps two members' identically-named planets separate", () => {
    const galaxy = build(
      circle([member("amy", [planet("shared")]), member("ben", [planet("shared")])]),
    );
    try {
      const nodes = systemNodes(galaxy);
      expect(nodes[0]?.getChildByLabel("planet-shared")).toBeTruthy();
      expect(nodes[1]?.getChildByLabel("planet-shared")).toBeTruthy();
      expect(nodes[0]?.getChildByLabel("planet-shared")).not.toBe(
        nodes[1]?.getChildByLabel("planet-shared"),
      );
    } finally {
      galaxy.destroy();
    }
  });

  it("checks one member in without touching the others' nodes", () => {
    const galaxy = build(
      circle([member("amy", [planet("a")]), member("ben", [planet("b")])]),
    );
    try {
      const benBefore = systemNodes(galaxy)[1]?.getChildByLabel("planet-b");
      galaxy.setSnapshot(
        circle([
          member("amy", [planet("a", { shine: true })]),
          member("ben", [planet("b")]),
        ]),
      );
      expect(systemNodes(galaxy)[1]?.getChildByLabel("planet-b")).toBe(
        benBefore,
      );
    } finally {
      galaxy.destroy();
    }
  });

  /**
   * **The load case, as far as a test can take it.**
   *
   * Ten members with ten goals each is the Circle cap, and it is ten times what
   * this renderer has ever drawn. What this can prove is that the scene builds,
   * ticks and tears down at that size — a hundred planets, a hundred orbit
   * rings, ten suns — without anything falling over.
   *
   * **What it cannot prove is that it is fast.** There is no GPU here and
   * nothing is rasterised, so the frame budget is a question for the playground
   * and a real phone. This is the floor, not the measurement.
   */
  it("builds, ticks and tears down ten members with ten goals each", () => {
    const galaxy = build(
      circle(
        Array.from({ length: 10 }, (_, m) =>
          member(
            `m${m}`,
            Array.from({ length: 10 }, (_, g) => planet(`m${m}-g${g}`)),
          ),
        ),
      ),
    );
    try {
      expect(systemNodes(galaxy)).toHaveLength(10);
      const planetCount = systemNodes(galaxy).reduce(
        (total, node) =>
          total +
          node.children.filter(
            (child) =>
              typeof child.label === "string" &&
              child.label.startsWith("planet-"),
          ).length,
        0,
      );
      expect(planetCount).toBe(100);

      for (let i = 0; i < 30; i += 1) {
        galaxy.tick(16);
      }
      expect(systemNodes(galaxy)).toHaveLength(10);
    } finally {
      galaxy.destroy();
    }
  });

  /**
   * **One of the two bugs behind "resizing distorts the galaxy".**
   *
   * `isCompactLayout` flips at 420px wide, and the mode carries a *projection*:
   * full size tilts at 0.95, compact at 0.5. `flattenFromTilt` is `sin(tilt)`,
   * so every orbit ellipse jumped from 0.81 of its width to 0.48 the moment a
   * pane crossed the threshold — and on a desktop split pane the handle lives
   * right there, so dragging it squashed the galaxy flat and back.
   *
   * The fix that left the fit alone missed this entirely, because this half was
   * never about scale. The mode is now decided once at mount. The other half is
   * two tests below.
   */
  it("does not change the projection when a pane is dragged past 420px", () => {
    const galaxy = build(circle([member("amy", [planet("a")])]));
    try {
      const before = galaxy.getView();
      // Comfortably full-size, then narrower than COMPACT_MAX_WIDTH, and back.
      galaxy.layout(900, 700);
      expect(galaxy.getView()).toEqual(before);
      galaxy.layout(380, 700);
      expect(galaxy.getView(), "crossing 420px re-tilted the scene").toEqual(
        before,
      );
      galaxy.layout(900, 700);
      expect(galaxy.getView()).toEqual(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("still honours a compact mount", () => {
    // The mode is a fact about the surface, so a host that says "this is a
    // small embedded panel" still gets the compact projection.
    const full = new Galaxy({
      snapshot: circle([member("amy")]),
      width: 900,
      height: 700,
      reducedMotion: true,
    });
    const compact = new Galaxy({
      snapshot: circle([member("amy")]),
      width: 900,
      height: 700,
      reducedMotion: true,
      compact: true,
    });
    try {
      expect(compact.getView().tilt).not.toBe(full.getView().tilt);
    } finally {
      full.destroy();
      compact.destroy();
    }
  });

  it("shrinks the fit rather than cropping when the viewport gets small", () => {
    const galaxy = build(
      circle(
        Array.from({ length: 6 }, (_, m) =>
          member(`m${m}`, [planet(`m${m}-g`, { orbitRadius: 300 })]),
        ),
      ),
    );
    try {
      const clusterScale = (): number => {
        const node = galaxy.root.getChildByLabel("cluster");
        return node instanceof Container ? node.scale.x : 0;
      };
      const before = clusterScale();
      galaxy.layout(200, 200);
      expect(clusterScale(), "content would be cropped").toBeLessThan(before);
    } finally {
      galaxy.destroy();
    }
  });

  it("gives the same fit for the same viewport, whatever it was before", () => {
    /**
     * **The other half of "resizing distorts the galaxy", and the fix for it
     * was itself the previous fix.**
     *
     * `layout` used to keep the fit only when it shrank:
     *
     *     if (needed < this.baseFitScale) { … }
     *
     * That was written to stop a split-pane drag rescaling the scene under the
     * cursor, and it half worked — the galaxy stopped growing, and it also
     * stopped *recovering*. Drag a pane narrow and back and it stayed small;
     * wiggle it and the galaxy shrank monotonically toward nothing, because
     * every smaller viewport was remembered and no larger one ever was.
     *
     * **A one-way rule made the scene stateful about window history**, which is
     * the thing a viewport should never be. The fit now depends on the content
     * and the current viewport and nothing else, so this asserts the property
     * rather than a direction: the same size gives the same answer, whatever
     * route it arrived by.
     *
     * "It does not zoom" is still honoured, and by the clamp rather than by the
     * ratchet — `fitScaleForReach` is `Math.min(1, …)`, so once the content
     * fits, a bigger window shows more sky and changes no scale at all. That is
     * what the last two assertions check.
     *
     * **A Circle big enough that the fit actually bites.** An earlier version
     * used one member with one planet and passed with the broken behaviour
     * restored, because a small galaxy clamps to 1 at every size and nothing
     * could have differed. Mutation testing caught it.
     */
    const galaxy = build(
      circle(
        Array.from({ length: 8 }, (_, m) =>
          member(
            `m${m}`,
            Array.from({ length: 6 }, (_, g) =>
              planet(`m${m}-g${g}`, { orbitRadius: 120 + g * 40 }),
            ),
          ),
        ),
      ),
    );
    try {
      const clusterOf = (): number => {
        const node = galaxy.root.getChildByLabel("cluster");
        return node instanceof Container ? node.scale.x : 0;
      };

      galaxy.layout(600, 600);
      const atSix = clusterOf();
      expect(atSix, "the fit is not engaged, so this proves nothing").toBeLessThan(1);

      galaxy.layout(1200, 1200);
      const atTwelve = clusterOf();
      expect(atTwelve, "a bigger viewport drew the galaxy smaller").toBeGreaterThan(
        atSix,
      );

      // The whole bug, in one line: back to where it was.
      galaxy.layout(600, 600);
      expect(
        clusterOf(),
        "the same viewport gave a different fit the second time",
      ).toBe(atSix);

      // And a wiggle does not accumulate.
      galaxy.layout(400, 400);
      galaxy.layout(900, 900);
      galaxy.layout(600, 600);
      expect(clusterOf(), "wiggling the window shrank the galaxy").toBe(atSix);

      // Once it fits, growing shows more sky and rescales nothing.
      galaxy.layout(4000, 4000);
      const huge = clusterOf();
      galaxy.layout(6000, 6000);
      expect(huge, "the fit never reached its natural size").toBe(1);
      expect(clusterOf(), "a window past the fit still zoomed").toBe(huge);
    } finally {
      galaxy.destroy();
    }
  });

  it("re-centres on the new viewport", () => {
    const galaxy = build(circle([member("amy", [planet("a")])]));
    try {
      galaxy.layout(900, 700);
      const cluster = galaxy.root.getChildByLabel("cluster");
      expect(cluster instanceof Container ? cluster.x : 0).toBe(450);
      expect(cluster instanceof Container ? cluster.y : 0).toBe(350);
    } finally {
      galaxy.destroy();
    }
  });

  describe("focus", () => {
    const tenMembers = () =>
      circle(
        Array.from({ length: 10 }, (_, m) =>
          member(
            `m${m}`,
            Array.from({ length: 4 }, (_, g) =>
              planet(`m${m}-g${g}`, { orbitRadius: 120 + g * 60 }),
            ),
          ),
        ),
      );

    it("moves the camera rather than the layout", () => {
      /**
       * **Everyone sees the same sky.** Focus is a vantage point, not an
       * arrangement — a screenshot of the Circle has to mean the same thing
       * whoever took it, which is the same reasoning that keeps the viewer's
       * own sun from being centred.
       */
      const galaxy = build(tenMembers());
      try {
        const positions = systemNodes(galaxy).map((node) => ({
          x: node.x,
          y: node.y,
        }));
        galaxy.focusSystem("m4");
        expect(
          systemNodes(galaxy).map((node) => ({ x: node.x, y: node.y })),
          "focusing moved a system",
        ).toEqual(positions);
        expect(galaxy.getCamera()).not.toEqual({ panX: 0, panY: 0, zoom: 1 });
      } finally {
        galaxy.destroy();
      }
    });

    it("gets closer than the cluster view", () => {
      const galaxy = build(tenMembers());
      try {
        galaxy.focusSystem("m4");
        expect(galaxy.getCamera().zoom).toBeGreaterThan(1);
      } finally {
        galaxy.destroy();
      }
    });

    it("returns to the whole Circle", () => {
      const galaxy = build(tenMembers());
      try {
        galaxy.focusSystem("m4");
        galaxy.focusSystem(null);
        expect(galaxy.getFocusedSystem()).toBeNull();
        expect(galaxy.getCamera()).toEqual({ panX: 0, panY: 0, zoom: 1 });
      } finally {
        galaxy.destroy();
      }
    });

    it("ignores a member who is not there", () => {
      const galaxy = build(tenMembers());
      try {
        galaxy.focusSystem("nobody");
        expect(galaxy.getFocusedSystem()).toBeNull();
      } finally {
        galaxy.destroy();
      }
    });

    /**
     * **Focus cannot outlive its subject.** A camera framing a member who left
     * would sit staring at an empty slot with nothing to explain itself.
     */
    it("pulls back out when the focused member leaves", () => {
      const galaxy = build(circle([member("amy"), member("ben")]));
      try {
        galaxy.focusSystem("ben");
        expect(galaxy.getFocusedSystem()).toBe("ben");

        galaxy.setSnapshot(circle([member("amy")]));
        expect(galaxy.getFocusedSystem()).toBeNull();
      } finally {
        galaxy.destroy();
      }
    });
  });

  describe("the Circle finished", () => {
    const closed = (systems: SystemConfig[]): GalaxySnapshot =>
      circle(systems, { skyClosed: true });

    const bridgesOf = (galaxy: Galaxy) => {
      const node = galaxy.root.getChildByLabel("sky-bridges", true);
      if (!(node instanceof Graphics)) {
        throw new Error("no bridges");
      }
      return node;
    };

    /**
     * **Animated on purpose, and the first version of this was vacuous.**
     *
     * Every other test here uses `reducedMotion: true`, which makes `playFx`
     * call `update(1)` and `finish()` immediately. The gathering only exists
     * strictly between 0 and 1, so with motion off there was never anything to
     * see and the assertion could not fail. Mutation testing confirmed it.
     *
     * **What each half is actually held up by**, since they are not the same:
     *
     * - *The gather* is caught here. Forcing `convergence` to zero during the
     *   animation turns this test red.
     * - *The release* is caught by `convergenceAt(1) === 0` in
     *   `SkyBridges.test.ts`. Deleting the reset in the finish handler does
     *   **not** fail this test, because the final `update` already lands on
     *   zero — the reset is belt-and-braces for a cancelled animation, not the
     *   thing that returns the layout.
     *
     * Worth knowing before someone "simplifies" `convergenceAt` and takes the
     * guarantee with it.
     */
    const animated = (snap: GalaxySnapshot): Galaxy =>
      new Galaxy({
        snapshot: snap,
        width: 600,
        height: 600,
        starCap: 200,
        reducedMotion: false,
      });

    it("draws the Circle together and then releases it", () => {
      const members = [member("amy"), member("ben"), member("cat")];
      const galaxy = animated(circle(members));
      try {
        const at = () => systemNodes(galaxy).map((n) => ({ x: n.x, y: n.y }));
        const spread = () =>
          at().reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0);

        const before = at();
        const spreadBefore = spread();

        galaxy.setSnapshot(closed(members));

        // Part-way through: the systems should have drawn in.
        for (let i = 0; i < 20; i += 1) {
          galaxy.tick(16);
        }
        expect(
          spread(),
          "the Circle never gathered",
        ).toBeLessThan(spreadBefore);

        // And all the way through: back exactly where it started, because a day
        // closing must not permanently shift where a member sits.
        for (let i = 0; i < 300; i += 1) {
          galaxy.tick(16);
        }
        expect(
          at(),
          "the Circle did not return to its arrangement",
        ).toEqual(before);
      } finally {
        galaxy.destroy();
      }
    });

    it("does not light bridges for a Circle of one", () => {
      // A lone member closing their day already has a moment — the sun swells.
      const galaxy = build(snapshot([planet("a", { shine: true })], {
        dayClosed: true,
      }));
      try {
        expect(bridgesOf(galaxy).visible).toBe(false);
      } finally {
        galaxy.destroy();
      }
    });

    it("costs nothing while the Circle is simply open", () => {
      const galaxy = build(circle([member("amy"), member("ben")]));
      try {
        expect(bridgesOf(galaxy).visible).toBe(false);
      } finally {
        galaxy.destroy();
      }
    });

    it("clears when the Circle opens again", () => {
      const galaxy = build(circle([member("amy"), member("ben")]));
      try {
        galaxy.setSnapshot(closed([member("amy"), member("ben")]));
        galaxy.setSnapshot(circle([member("amy"), member("ben")]));
        expect(bridgesOf(galaxy).visible).toBe(false);
      } finally {
        galaxy.destroy();
      }
    });
  });

  it("frees a departing member's textures", () => {
    const galaxy = build(circle([member("amy"), member("ben")]));
    try {
      const ben = systemNodes(galaxy)[1];
      const veil = ben?.getChildByLabel("sun-veil", true);
      const texture = veil instanceof Sprite ? veil.texture : null;
      expect(texture?.destroyed).toBe(false);

      galaxy.setSnapshot(circle([member("amy")]));
      expect(
        texture?.destroyed,
        "a member who left kept their sun's textures",
      ).toBe(true);
    } finally {
      galaxy.destroy();
    }
  });
});

describe("Galaxy: teardown frees what it owns", () => {
  /**
   * **The regression test for a leak found by reading, on 1 September.**
   *
   * `Planet` and `Nebula` both register a `destroyed` handler to free the
   * textures they generate. `Sun` did not, so its veil and photosphere maps —
   * 128×128 each — outlived every sun that was ever built. Harmless while
   * there was one sun and never rebuilt; a Circle has one per member and
   * rebuilds on any colour change.
   *
   * Pixi's `destroy({ children: true })` frees display objects and
   * **deliberately not their textures**, so this cannot be fixed by passing a
   * flag: the shade, glow and ray maps are shared by the whole scene and
   * destroying them from a sun would blank everything else.
   */
  it("destroys the textures a sun generated for itself", () => {
    const galaxy = build(snapshot([planet("a")]));
    const own = sunOwnTextures(galaxy);
    expect(own.every((texture) => texture.destroyed)).toBe(false);

    galaxy.destroy();

    expect(
      own.map((texture) => texture.destroyed),
      "a sun's generated textures outlived the scene",
    ).toEqual([true, true]);
  });

  it("destroys the textures of a sun that was replaced, not just the last one", () => {
    const galaxy = build(snapshot([planet("a")]));
    try {
      const first = sunOwnTextures(galaxy);
      galaxy.setSnapshot(
        snapshot([planet("a")], {
          sun: { color: 0x00d9a3, radius: 28, growth: 0.2 },
        }),
      );
      const second = sunOwnTextures(galaxy);

      expect(second[0], "the sun was not rebuilt").not.toBe(first[0]);
      expect(
        first.map((texture) => texture.destroyed),
        "the replaced sun kept its textures",
      ).toEqual([true, true]);
    } finally {
      galaxy.destroy();
    }
  });

  it("marks the scene root destroyed", () => {
    const galaxy = build(snapshot([planet("a")]));
    galaxy.destroy();
    expect(galaxy.root.destroyed).toBe(true);
  });
});
