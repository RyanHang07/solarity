import type {
  GalaxySnapshot,
  PlanetConfig,
  StarConfig,
  SystemConfig,
} from "../types";

/** What changed inside one system. Only built when something did. */
export type SystemDiff = {
  systemId: string;
  addedPlanets: PlanetConfig[];
  removedPlanets: PlanetConfig[];
  shineOn: PlanetConfig[];
  shineOff: PlanetConfig[];
  updatedPlanets: PlanetConfig[];
  orbitRefitPlanets: PlanetConfig[];
  sunChanged: boolean;
  dayClosedOn: boolean;
  dayClosedOff: boolean;
};

export type SnapshotDiff = {
  /**
   * Systems present in **both** snapshots that changed.
   *
   * **A system that did not change is absent, not empty**, and on a phone that
   * is the difference between this being cheap and being why a Circle stutters.
   * One person checking in produces one entry, not ten: the other nine members
   * allocate nothing and are never walked by the consumer.
   */
  systems: SystemDiff[];
  /** A member joined. */
  addedSystems: SystemConfig[];
  /** A member left, or was removed. */
  removedSystems: SystemConfig[];

  // ── sky ──
  appendedStars: StarConfig[];
  starsReplaced: boolean;
  skyClosedOn: boolean;
  skyClosedOff: boolean;
};

const sameStar = (a: StarConfig, b: StarConfig): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.size === b.size &&
  a.twinkle === b.twinkle &&
  a.seed === b.seed &&
  a.color === b.color;

const planetCoreEqual = (a: PlanetConfig, b: PlanetConfig): boolean =>
  a.color === b.color &&
  a.radius === b.radius &&
  a.orbitRadius === b.orbitRadius &&
  a.orbitSpeed === b.orbitSpeed &&
  a.phase === b.phase &&
  a.beltVisible === b.beltVisible &&
  a.surfaceKind === b.surfaceKind &&
  a.visualSeed === b.visualSeed &&
  a.belt?.color === b.belt?.color &&
  a.belt?.innerRadius === b.belt?.innerRadius &&
  a.belt?.outerRadius === b.belt?.outerRadius;

const planetOrbitOnlyChange = (
  before: PlanetConfig,
  after: PlanetConfig,
): boolean =>
  before.orbitRadius !== after.orbitRadius &&
  before.color === after.color &&
  before.radius === after.radius &&
  before.orbitSpeed === after.orbitSpeed &&
  before.phase === after.phase &&
  before.beltVisible === after.beltVisible &&
  before.surfaceKind === after.surfaceKind &&
  before.visualSeed === after.visualSeed &&
  before.belt?.color === after.belt?.color &&
  before.belt?.innerRadius === after.belt?.innerRadius &&
  before.belt?.outerRadius === after.belt?.outerRadius;

const sunHasChanged = (before: SystemConfig, after: SystemConfig): boolean =>
  before.sun.color !== after.sun.color ||
  before.sun.radius !== after.sun.radius ||
  before.sun.growth !== after.sun.growth;

const systemChanged = (diff: SystemDiff): boolean =>
  diff.addedPlanets.length > 0 ||
  diff.removedPlanets.length > 0 ||
  diff.shineOn.length > 0 ||
  diff.shineOff.length > 0 ||
  diff.updatedPlanets.length > 0 ||
  diff.orbitRefitPlanets.length > 0 ||
  diff.sunChanged ||
  diff.dayClosedOn ||
  diff.dayClosedOff;

/**
 * Compare one system against its previous self.
 *
 * **Two maps and two linear passes, never a nested `find`.** Ten members with
 * ten goals each is a hundred planets, and the quadratic version of this is
 * exactly the shape that turns a check-in into a visible hitch on a mid-range
 * phone.
 */
const diffSystem = (before: SystemConfig, after: SystemConfig): SystemDiff => {
  const beforeById = new Map(
    before.planets.map((planet) => [planet.id, planet]),
  );
  const afterIds = new Set(after.planets.map((planet) => planet.id));

  const addedPlanets: PlanetConfig[] = [];
  const removedPlanets: PlanetConfig[] = [];
  const shineOn: PlanetConfig[] = [];
  const shineOff: PlanetConfig[] = [];
  const updatedPlanets: PlanetConfig[] = [];
  const orbitRefitPlanets: PlanetConfig[] = [];

  for (const planet of after.planets) {
    const previous = beforeById.get(planet.id);
    if (!previous) {
      addedPlanets.push(planet);
      continue;
    }
    if (!previous.shine && planet.shine) {
      shineOn.push(planet);
    } else if (previous.shine && !planet.shine) {
      shineOff.push(planet);
    }
    if (!planetCoreEqual(previous, planet)) {
      if (planetOrbitOnlyChange(previous, planet)) {
        orbitRefitPlanets.push(planet);
      } else {
        updatedPlanets.push(planet);
      }
    }
  }

  for (const planet of before.planets) {
    if (!afterIds.has(planet.id)) {
      removedPlanets.push(planet);
    }
  }

  return {
    systemId: after.id,
    addedPlanets,
    removedPlanets,
    shineOn,
    shineOff,
    updatedPlanets,
    orbitRefitPlanets,
    sunChanged: sunHasChanged(before, after),
    dayClosedOn: !before.dayClosed && Boolean(after.dayClosed),
    dayClosedOff: Boolean(before.dayClosed) && !after.dayClosed,
  };
};

/**
 * What changed between two skies.
 *
 * ## Systems are matched by `id`, and can come and go
 *
 * v1 had no equivalent, because there was only ever one system. A Circle gains
 * one when somebody joins and loses one when somebody leaves, and both are
 * ordinary rather than exceptional — so they are diff entries rather than a
 * reason to rebuild the scene. Rebuilding would restart every other member's
 * orbits from their starting phase, which reads as the screen glitching
 * because a stranger arrived.
 *
 * ## Planet ids are unique per system, not globally
 *
 * Solarity's goal ids happen to be globally unique and the module must not
 * depend on it. Nothing here compares a planet across systems: each system's
 * planets are only ever matched against that same system's previous planets.
 */
export const diffSnapshot = (
  prev: GalaxySnapshot,
  next: GalaxySnapshot,
): SnapshotDiff => {
  const prevById = new Map(
    prev.systems.map((system) => [system.id, system] as const),
  );
  const nextIds = new Set(next.systems.map((system) => system.id));

  const systems: SystemDiff[] = [];
  const addedSystems: SystemConfig[] = [];
  for (const system of next.systems) {
    const previous = prevById.get(system.id);
    if (!previous) {
      addedSystems.push(system);
      continue;
    }
    const diff = diffSystem(previous, system);
    if (systemChanged(diff)) {
      systems.push(diff);
    }
  }

  const removedSystems = prev.systems.filter(
    (system) => !nextIds.has(system.id),
  );

  /**
   * **Stars are append-only in the ordinary case**, which is what makes an
   * achievement cheap: the starfield adds particles rather than rebuilding two
   * thousand of them. The prefix check is what proves that is safe, and it
   * earns its pass — a full replace is the most expensive single thing this
   * renderer can be asked to do, and the one most likely to drop frames on a
   * phone.
   */
  const prefix =
    next.stars.length >= prev.stars.length &&
    prev.stars.every((star, index) => {
      const other = next.stars[index];
      return other !== undefined && sameStar(star, other);
    });

  return {
    systems,
    addedSystems,
    removedSystems,
    appendedStars: prefix ? next.stars.slice(prev.stars.length) : [],
    starsReplaced: !prefix,
    skyClosedOn: !prev.skyClosed && Boolean(next.skyClosed),
    skyClosedOff: Boolean(prev.skyClosed) && !next.skyClosed,
  };
};
