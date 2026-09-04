import type { SnapshotDiff, SystemDiff } from "./diffSnapshot";

/**
 * FX keys are scoped by system.
 *
 * **`shine:<systemId>:<planetId>`, not `shine:<planetId>`.** With one sun a
 * planet id was a unique key; with ten, two members' planets could collide and
 * one person's check-in would cancel another's animation. Solarity's goal ids
 * happen to be globally unique, and depending on that would be depending on
 * the host's schema from inside the renderer.
 *
 * `:` because the queue already reads that way, and neither a uuid nor the
 * member ids Solarity uses contain one.
 */
export const shineKind = (systemId: string, planetId: string): string =>
  `shine:${systemId}:${planetId}`;
export const appearKind = (systemId: string, planetId: string): string =>
  `appear:${systemId}:${planetId}`;
export const burstKind = (systemId: string, planetId: string): string =>
  `burst:${systemId}:${planetId}`;

/** Per system, because each sun swells on its own day. */
export const dayClosedKind = (systemId: string): string =>
  `day-closed:${systemId}`;
export const orbitRefitKind = (systemId: string): string =>
  `orbit-refit:${systemId}`;

export const NEBULA_BIRTH_KIND = "nebula-birth";
export const CAMERA_FIT_KIND = "camera-fit";
/** Every member finished. One sky, one moment, one key. */
export const SKY_CLOSED_KIND = "sky-closed";

export const planetFxKinds = (
  systemId: string,
  planetId: string,
): string[] => [
  shineKind(systemId, planetId),
  appearKind(systemId, planetId),
  burstKind(systemId, planetId),
];

/** What to start for one system. Planet ids, scoped by the system they are in. */
export type SystemFxPlan = {
  systemId: string;
  startShine: string[];
  startAppear: string[];
  startBurst: string[];
  startOrbitRefit: boolean;
  startDayClosed: boolean;
  startShineOff: string[];
  startDayOpen: boolean;
};

export type SnapshotFxPlan = {
  /** Fully qualified kinds to cancel before anything new starts. */
  cancel: string[];
  /** **Only systems that changed.** A quiet member costs nothing here. */
  systems: SystemFxPlan[];
  startSkyClosed: boolean;
  startSkyOpen: boolean;
};

const planSystem = (diff: SystemDiff, cancel: Set<string>): SystemFxPlan => {
  const { systemId } = diff;
  const updatedIds = new Set(diff.updatedPlanets.map((planet) => planet.id));

  for (const planet of diff.removedPlanets) {
    for (const kind of planetFxKinds(systemId, planet.id)) {
      cancel.add(kind);
    }
  }
  for (const planet of diff.updatedPlanets) {
    for (const kind of planetFxKinds(systemId, planet.id)) {
      cancel.add(kind);
    }
  }
  for (const planet of diff.shineOff) {
    cancel.add(shineKind(systemId, planet.id));
  }
  for (const planet of diff.shineOn) {
    cancel.add(shineKind(systemId, planet.id));
  }
  if (diff.dayClosedOn || diff.dayClosedOff) {
    cancel.add(dayClosedKind(systemId));
  }

  const startOrbitRefit =
    diff.addedPlanets.length > 0 ||
    diff.removedPlanets.length > 0 ||
    diff.orbitRefitPlanets.length > 0;
  if (startOrbitRefit) {
    cancel.add(orbitRefitKind(systemId));
  }

  return {
    systemId,
    startShine: diff.shineOn
      .filter((planet) => !updatedIds.has(planet.id))
      .map((planet) => planet.id),
    startAppear: diff.addedPlanets.map((planet) => planet.id),
    startBurst: diff.removedPlanets.map((planet) => planet.id),
    startOrbitRefit,
    startDayClosed: diff.dayClosedOn,
    startShineOff: diff.shineOff
      .filter((planet) => !updatedIds.has(planet.id))
      .map((planet) => planet.id),
    startDayOpen: diff.dayClosedOff,
  };
};

/**
 * Turn a diff into the animations to cancel and start.
 *
 * **Nothing is planned for a system that did not change**, which is the whole
 * reason `SnapshotDiff.systems` omits them rather than listing them empty. In a
 * Circle of ten, one check-in should cost one system's worth of work, and a
 * plan that walked all ten to discover nine had nothing to do would be paying
 * for the Circle's size on every single interaction.
 *
 * **A system that left is not planned either.** Its FX are cancelled by the
 * caller when it tears the system down, because cancelling by key here would
 * mean enumerating every planet it used to have.
 */
export const planSnapshotFx = (diff: SnapshotDiff): SnapshotFxPlan => {
  const cancel = new Set<string>();
  const systems = diff.systems.map((system) => planSystem(system, cancel));

  if (diff.skyClosedOn || diff.skyClosedOff) {
    cancel.add(SKY_CLOSED_KIND);
  }

  return {
    cancel: [...cancel],
    systems,
    startSkyClosed: diff.skyClosedOn,
    startSkyOpen: diff.skyClosedOff,
  };
};
