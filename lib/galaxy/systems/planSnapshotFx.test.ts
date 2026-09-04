import { describe, expect, it } from "vitest";
import type { GalaxySnapshot, PlanetConfig, StarConfig } from "../types";
import { SELF_SYSTEM_ID, singleSystemSnapshot } from "../singleSystem";
import { diffSnapshot } from "./diffSnapshot";
import { FxQueue } from "./fxQueue";
import {
  appearKind as appearFor,
  burstKind as burstFor,
  dayClosedKind,
  planSnapshotFx,
  shineKind as shineFor,
  type SnapshotFxPlan,
  type SystemFxPlan,
} from "./planSnapshotFx";

/**
 * These exercise one person, so every key is scoped to the one system there is.
 *
 * **The scoping is the point of the v2 keys**: `shine:<system>:<planet>` rather
 * than `shine:<planet>`, so two members' planets cannot cancel each other's
 * animations. `diffSnapshot.test.ts` covers the multi-system side; this file
 * keeps the single-system behaviour it always had.
 */
const shineKind = (planetId: string): string =>
  shineFor(SELF_SYSTEM_ID, planetId);
const appearKind = (planetId: string): string =>
  appearFor(SELF_SYSTEM_ID, planetId);
const burstKind = (planetId: string): string =>
  burstFor(SELF_SYSTEM_ID, planetId);
const DAY_CLOSED_KIND = dayClosedKind(SELF_SYSTEM_ID);

/** The single system's plan, or an empty one when nothing about it changed. */
const one = (plan: SnapshotFxPlan): SystemFxPlan =>
  plan.systems[0] ?? {
    systemId: SELF_SYSTEM_ID,
    startShine: [],
    startAppear: [],
    startBurst: [],
    startOrbitRefit: false,
    startDayClosed: false,
    startShineOff: [],
    startDayOpen: false,
  };

const planet = (
  id: string,
  shine: boolean,
  color = 0xff8866,
): PlanetConfig => ({
  id,
  color,
  radius: 8,
  orbitRadius: 120,
  orbitSpeed: 0.2,
  phase: 1,
  shine,
});

const star = (color: number): StarConfig => ({
  x: 0.4,
  y: 0.4,
  size: 1,
  twinkle: 0.2,
  seed: 1,
  color,
});

const snap = (
  planets: PlanetConfig[],
  opts?: { dayClosed?: boolean; stars?: StarConfig[] },
): GalaxySnapshot =>
  singleSystemSnapshot({
    sun: { color: 0xf4a261, radius: 28 },
    planets,
    stars: opts?.stars ?? [],
    dayClosed: opts?.dayClosed,
  });

const applyPlan = (queue: FxQueue, prev: GalaxySnapshot, next: GalaxySnapshot) => {
  const plan = planSnapshotFx(diffSnapshot(prev, next));
  queue.cancelMany(plan.cancel);
  const start = (kind: string): void => {
    queue.play({
      kind,
      duration: 100,
      update: () => undefined,
      finish: () => undefined,
    });
  };
  const system = one(plan);
  for (const id of system.startShine) {
    start(shineKind(id));
  }
  for (const id of system.startShineOff) {
    start(shineKind(id));
  }
  for (const id of system.startAppear) {
    start(appearKind(id));
  }
  for (const id of system.startBurst) {
    start(burstKind(id));
  }
  if (system.startDayClosed || system.startDayOpen) {
    start(DAY_CLOSED_KIND);
  }
  return system;
};

describe("planSnapshotFx", () => {
  it("keeps another planet's shine job when one undoes", () => {
    const prev = snap([planet("a", true), planet("b", true)]);
    const next = snap([planet("a", false), planet("b", true)]);
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(plan.cancel).toEqual([shineKind("a")]);
    expect(one(plan).startShineOff).toEqual(["a"]);
    expect(one(plan).startShine).toEqual([]);
    expect(one(plan).startDayClosed).toBe(false);
  });

  it("starts shine and day-closed together on the last check-in", () => {
    const prev = snap([planet("a", true), planet("b", false)], {
      dayClosed: false,
    });
    const next = snap([planet("a", true), planet("b", true)], {
      dayClosed: true,
    });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(one(plan).startShine).toEqual(["b"]);
    expect(one(plan).startDayClosed).toBe(true);
    expect(plan.cancel).toEqual(
      expect.arrayContaining([shineKind("b"), DAY_CLOSED_KIND]),
    );
  });

  it("undo of the last check-in cancels shine and the sun swell", () => {
    const prev = snap([planet("a", true), planet("b", true)], {
      dayClosed: true,
    });
    const next = snap([planet("a", true), planet("b", false)], {
      dayClosed: false,
    });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(plan.cancel).toEqual(
      expect.arrayContaining([shineKind("b"), DAY_CLOSED_KIND]),
    );
    expect(one(plan).startShineOff).toEqual(["b"]);
    expect(one(plan).startDayOpen).toBe(true);
    expect(one(plan).startDayClosed).toBe(false);
    expect(one(plan).startBurst).toEqual([]);
  });

  it("achieve cancels that planet's shine and starts a burst without touching others", () => {
    const color = 0x44aa88;
    const prev = snap([planet("a", true, color), planet("b", true)], {
      dayClosed: true,
      stars: [],
    });
    const next = snap([planet("b", true)], {
      dayClosed: true,
      stars: [star(color)],
    });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(one(plan).startBurst).toEqual(["a"]);
    expect(plan.cancel).toEqual(
      expect.arrayContaining([
        shineKind("a"),
        appearKind("a"),
        burstKind("a"),
      ]),
    );
    expect(plan.cancel).not.toContain(shineKind("b"));
    expect(one(plan).startDayClosed).toBe(false);
    expect(one(plan).startDayOpen).toBe(false);
  });

  it("achieving the last planet opens the day and bursts without a swell", () => {
    const prev = snap([planet("a", true)], { dayClosed: true });
    const next = snap([], { dayClosed: false, stars: [star(0xff8866)] });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(one(plan).startBurst).toEqual(["a"]);
    expect(one(plan).startDayOpen).toBe(true);
    expect(one(plan).startDayClosed).toBe(false);
    expect(plan.cancel).toContain(DAY_CLOSED_KIND);
  });

  it("achieving the last dark planet can close the day while bursting", () => {
    const prev = snap([planet("a", true), planet("b", false)], {
      dayClosed: false,
    });
    const next = snap([planet("a", true)], { dayClosed: true });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(one(plan).startBurst).toEqual(["b"]);
    expect(one(plan).startDayClosed).toBe(true);
    expect(one(plan).startShine).toEqual([]);
  });

  it("adding a dark goal while closed opens the day without bursting", () => {
    const prev = snap([planet("a", true)], { dayClosed: true });
    const next = snap([planet("a", true), planet("b", false)], {
      dayClosed: false,
    });
    const plan = planSnapshotFx(diffSnapshot(prev, next));
    expect(one(plan).startAppear).toEqual(["b"]);
    expect(one(plan).startDayOpen).toBe(true);
    expect(one(plan).startBurst).toEqual([]);
    expect(one(plan).startShine).toEqual([]);
  });
});

describe("snapshot FX lanes", () => {
  it("undo mid-shine starts a dim job on that planet and leaves another shine running", () => {
    const queue = new FxQueue();
    const open = snap([planet("a", false), planet("b", false)]);
    const aLit = snap([planet("a", true), planet("b", false)]);
    const bothLit = snap([planet("a", true), planet("b", true)], {
      dayClosed: true,
    });
    applyPlan(queue, open, aLit);
    queue.tick(30);
    applyPlan(queue, aLit, bothLit);
    queue.tick(30);
    expect(queue.kinds()).toEqual(
      expect.arrayContaining([shineKind("a"), shineKind("b"), DAY_CLOSED_KIND]),
    );

    const undone = snap([planet("a", true), planet("b", false)], {
      dayClosed: false,
    });
    const plan = applyPlan(queue, bothLit, undone);
    expect(plan.startShineOff).toEqual(["b"]);
    expect(plan.startDayOpen).toBe(true);
    expect(queue.has(shineKind("a"))).toBe(true);
    expect(queue.has(shineKind("b"))).toBe(true);
    expect(queue.has(DAY_CLOSED_KIND)).toBe(true);
    queue.tick(100);
    expect(queue.has(shineKind("b"))).toBe(false);
    expect(queue.has(DAY_CLOSED_KIND)).toBe(false);
  });

  it("achieve mid-shine replaces shine with burst and keeps the sun swell", () => {
    const queue = new FxQueue();
    const closed = snap([planet("a", true), planet("b", true)], {
      dayClosed: true,
    });
    queue.play({
      kind: shineKind("a"),
      duration: 100,
      update: () => undefined,
      finish: () => undefined,
    });
    queue.play({
      kind: DAY_CLOSED_KIND,
      duration: 200,
      update: () => undefined,
      finish: () => undefined,
    });
    const after = snap([planet("b", true)], { dayClosed: true });
    applyPlan(queue, closed, after);
    expect(queue.has(shineKind("a"))).toBe(false);
    expect(queue.has(burstKind("a"))).toBe(true);
    expect(queue.has(DAY_CLOSED_KIND)).toBe(true);
    expect(queue.has(shineKind("b"))).toBe(false);
  });

  it("check-in of a second planet does not restart the first planet's shine", () => {
    const queue = new FxQueue();
    const open = snap([planet("a", false), planet("b", false)]);
    const aLit = snap([planet("a", true), planet("b", false)]);
    applyPlan(queue, open, aLit);
    queue.tick(40);
    const both = snap([planet("a", true), planet("b", true)]);
    applyPlan(queue, aLit, both);
    expect(queue.kinds()).toEqual([shineKind("a"), shineKind("b")]);
  });
});
