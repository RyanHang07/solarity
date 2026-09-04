import { describe, expect, it } from "vitest";
import { singleSystemSnapshot } from "../singleSystem";
import type { GalaxySnapshot, PlanetConfig, SystemConfig } from "../types";
import { diffSnapshot } from "./diffSnapshot";
import { planSnapshotFx } from "./planSnapshotFx";

const planet = (
  id: string,
  orbitRadius: number,
  color = 0xff8866,
  over: Partial<PlanetConfig> = {},
): PlanetConfig => ({
  id,
  color,
  radius: 8,
  orbitRadius,
  orbitSpeed: 0.2,
  phase: 1,
  shine: false,
  ...over,
});

const sky = (planets: PlanetConfig[]): GalaxySnapshot =>
  singleSystemSnapshot({
    sun: { color: 0xf4a261, radius: 28 },
    planets,
    stars: [],
  });

const system = (
  id: string,
  planets: PlanetConfig[],
  over: Partial<SystemConfig> = {},
): SystemConfig => ({
  id,
  sun: { color: 0xf4a261, radius: 28 },
  planets,
  ...over,
});

const circle = (
  systems: SystemConfig[],
  over: Partial<GalaxySnapshot> = {},
): GalaxySnapshot => ({ systems, stars: [], ...over });

/** The one system's diff, when there is exactly one and it changed. */
const only = (snapshotDiff: ReturnType<typeof diffSnapshot>) => {
  const entry = snapshotDiff.systems[0];
  if (!entry) {
    throw new Error("expected one changed system");
  }
  return entry;
};

describe("diffSnapshot: planets within a system", () => {
  it("routes radius-only changes to orbitRefitPlanets", () => {
    const diff = diffSnapshot(
      sky([planet("a", 120), planet("b", 220)]),
      sky([planet("a", 95), planet("b", 183)]),
    );
    expect(only(diff).orbitRefitPlanets.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(only(diff).updatedPlanets).toEqual([]);
  });

  it("keeps colour changes in updatedPlanets", () => {
    const diff = diffSnapshot(
      sky([planet("a", 120, 0xff0000)]),
      sky([planet("a", 95, 0x00ff00)]),
    );
    expect(only(diff).orbitRefitPlanets).toEqual([]);
    expect(only(diff).updatedPlanets.map((item) => item.id)).toEqual(["a"]);
  });

  it("keeps surface changes in updatedPlanets", () => {
    const diff = diffSnapshot(
      sky([planet("a", 120, 0xff8866, { surfaceKind: "terra" })]),
      sky([planet("a", 120, 0xff8866, { surfaceKind: "ice" })]),
    );
    expect(only(diff).updatedPlanets.map((item) => item.id)).toEqual(["a"]);
  });

  it("plans an orbit refit when goals are added or removed", () => {
    const plan = planSnapshotFx(
      diffSnapshot(sky([planet("a", 120)]), sky([planet("a", 95), planet("b", 183)])),
    );
    expect(plan.systems[0]?.startOrbitRefit).toBe(true);
    expect(plan.systems[0]?.startAppear).toEqual(["b"]);
  });
});

describe("diffSnapshot: systems", () => {
  /**
   * **The property the whole Circle galaxy leans on.** One person checking in
   * must not cost anything for the nine who did not, and the way that is
   * guaranteed is that an unchanged system is *absent* from the diff rather
   * than present and empty. A consumer cannot accidentally walk what is not
   * there.
   */
  it("omits systems that did not change", () => {
    const before = circle([
      system("amy", [planet("a", 120)]),
      system("ben", [planet("b", 120)]),
      system("cat", [planet("c", 120)]),
    ]);
    const after = circle([
      system("amy", [planet("a", 120)]),
      system("ben", [planet("b", 120, 0xff8866, { shine: true })]),
      system("cat", [planet("c", 120)]),
    ]);

    const diff = diffSnapshot(before, after);
    expect(diff.systems.map((entry) => entry.systemId)).toEqual(["ben"]);
    expect(diff.systems[0]?.shineOn.map((p) => p.id)).toEqual(["b"]);
  });

  it("produces nothing at all when nobody changed", () => {
    const before = circle([system("amy", [planet("a", 120)])]);
    const after = circle([system("amy", [planet("a", 120)])]);
    expect(diffSnapshot(before, after).systems).toEqual([]);
  });

  it("reports a member joining as an added system, not a change", () => {
    const diff = diffSnapshot(
      circle([system("amy", [planet("a", 120)])]),
      circle([system("amy", [planet("a", 120)]), system("ben", [])]),
    );
    expect(diff.addedSystems.map((entry) => entry.id)).toEqual(["ben"]);
    expect(diff.removedSystems).toEqual([]);
    // Amy did not change, so she is not in the diff at all.
    expect(diff.systems).toEqual([]);
  });

  it("reports a member leaving as a removed system", () => {
    const diff = diffSnapshot(
      circle([system("amy", [planet("a", 120)]), system("ben", [])]),
      circle([system("amy", [planet("a", 120)])]),
    );
    expect(diff.removedSystems.map((entry) => entry.id)).toEqual(["ben"]);
    expect(diff.addedSystems).toEqual([]);
  });

  /**
   * **Planet ids are unique per system, not globally.** Solarity's goal ids
   * happen to be unique everywhere and the renderer must not depend on it, so
   * two members holding the same planet id must not read as one planet moving
   * between them.
   */
  it("never matches a planet across systems", () => {
    const before = circle([
      system("amy", [planet("shared", 120)]),
      system("ben", []),
    ]);
    const after = circle([
      system("amy", []),
      system("ben", [planet("shared", 120)]),
    ]);

    const diff = diffSnapshot(before, after);
    const amy = diff.systems.find((entry) => entry.systemId === "amy");
    const ben = diff.systems.find((entry) => entry.systemId === "ben");

    expect(amy?.removedPlanets.map((p) => p.id)).toEqual(["shared"]);
    expect(ben?.addedPlanets.map((p) => p.id)).toEqual(["shared"]);
  });

  it("tracks each system's sun and day separately", () => {
    const before = circle([
      system("amy", [], { dayClosed: false }),
      system("ben", [], { dayClosed: true }),
    ]);
    const after = circle([
      system("amy", [], { dayClosed: true }),
      system("ben", [], { dayClosed: true, sun: { color: 0x00ff00, radius: 28 } }),
    ]);

    const diff = diffSnapshot(before, after);
    const amy = diff.systems.find((entry) => entry.systemId === "amy");
    const ben = diff.systems.find((entry) => entry.systemId === "ben");

    expect(amy?.dayClosedOn).toBe(true);
    expect(amy?.sunChanged).toBe(false);
    expect(ben?.dayClosedOn).toBe(false);
    expect(ben?.sunChanged).toBe(true);
  });
});

describe("diffSnapshot: the sky", () => {
  it("reports the whole Circle closing separately from any one member", () => {
    const before = circle([system("amy", [], { dayClosed: true })], {
      skyClosed: false,
    });
    const after = circle([system("amy", [], { dayClosed: true })], {
      skyClosed: true,
    });

    const diff = diffSnapshot(before, after);
    // Nothing about Amy changed; the Circle's own state did.
    expect(diff.systems).toEqual([]);
    expect(diff.skyClosedOn).toBe(true);
  });

  it("appends stars rather than replacing when the prefix is unchanged", () => {
    const star = (x: number) => ({
      x,
      y: 0.5,
      size: 1,
      twinkle: 0.2,
      seed: 1,
      color: 0xffffff,
    });
    const before = circle([system("amy", [])], { stars: [star(0.1)] });
    const after = circle([system("amy", [])], { stars: [star(0.1), star(0.2)] });

    const diff = diffSnapshot(before, after);
    expect(diff.starsReplaced).toBe(false);
    expect(diff.appendedStars).toHaveLength(1);
  });

  it("falls back to a replace when an earlier star moved", () => {
    // The expensive path, and the one worth knowing you are on: rebuilding two
    // thousand particles is the heaviest thing this renderer does.
    const star = (x: number) => ({
      x,
      y: 0.5,
      size: 1,
      twinkle: 0.2,
      seed: 1,
      color: 0xffffff,
    });
    const before = circle([system("amy", [])], { stars: [star(0.1)] });
    const after = circle([system("amy", [])], { stars: [star(0.9), star(0.2)] });

    expect(diffSnapshot(before, after).starsReplaced).toBe(true);
  });
});
