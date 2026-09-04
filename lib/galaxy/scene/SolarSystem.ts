import { Container, Graphics, type Texture } from "pixi.js";
import {
  FX_APPEAR_MS,
  FX_BURST_MS,
  FX_DAY_CLOSED_MS,
  FX_SHINE_MS,
  ORBIT_REFIT_MS,
  SUN_DISPLAY_SCALE,
} from "../constants";
import { nebulaReach } from "../systems/nebulaClusters";
import { OrbitRefitCoordinator } from "../systems/orbitRefitCoordinator";
import {
  appearKind,
  burstKind,
  dayClosedKind,
  orbitRefitKind,
  shineKind,
} from "../systems/planSnapshotFx";
import {
  createOrbitBody,
  effectiveOrbitRadius,
  flattenFromTilt,
  lerpOrbitRadii,
  orbitSpeedScale,
  poseOrbits,
  snapOrbitRadii,
  tickOrbits,
  type OrbitBody,
} from "../systems/OrbitSystem";
import { dimLight, shineLight } from "../systems/shineEnvelope";
import type {
  PlanetConfig,
  SunConfig,
  ViewRotation,
} from "../types";
import { paintOrbitRingAtRadius, type OrbitRing } from "./OrbitPaths";
import {
  createPlanet,
  paintBeltLook,
  paintPlanetLook,
  tickPlanetSpin,
  tickPlanetSurface,
} from "./Planet";
import { createBelt, setBeltFlatten } from "./Ring";
import { createSun, poseSunCorona, poseSunCoronaAt, tickSunSurface } from "./Sun";

/**
 * One sun and the planets that orbit it.
 *
 * ## Why this is its own class
 *
 * `Galaxy` held everything: the starfield and the ambience, which belong to
 * the canvas, and the sun, orbits, rings and refit, which belong to **one
 * person**. That was invisible while there was exactly one person. Solarity's
 * Circle galaxy puts up to ten in a single canvas, which would have meant
 * turning thirteen fields into arrays and touching every method that reads
 * them.
 *
 * So the tier that was already there is now named. `Galaxy` is the sky;
 * this is a system in it, and the sky can hold any number of them.
 *
 * **Nothing here changed behaviour.** This is a move, checked against twenty
 * characterisation tests written specifically to constrain it — see
 * `Galaxy.test.ts` for what they can and cannot see.
 *
 * ## What it does not own
 *
 * The **camera and the fit** stay with the sky: one canvas, one camera, and a
 * fit that will eventually have to span a cluster rather than one system. The
 * orbit refit still drives the fit while it animates, which is what
 * `SystemHost.beginReachAnimation` is for.
 *
 * The **achieve burst** stays with the sky too, because it spawns stars into
 * the starfield, a burst into the ambience, and a ring on the sky's own root.
 * `removePlanet` runs the part that belongs to the system — the fade, the
 * ring, the detach — and asks the host for the rest.
 *
 * The **nebula** is still a child of `root` and still managed by the sky. It
 * moves out in v2, where it becomes background for the whole canvas rather
 * than for one system; moving it here first would be a step backwards.
 */
export type SystemHost = {
  /** Shared and mutated by the sky. Read every time, never copied. */
  readonly view: ViewRotation;
  readonly reducedMotion: boolean;
  readonly shadeTexture: Texture;
  readonly sunGlowTexture: Texture;
  readonly sunRayTexture: Texture;

  playFx(
    duration: number,
    update: (t: number) => void,
    finish: () => void,
    kind: string,
  ): void;
  hasFx(kind: string): boolean;
  cancelFx(kind: string): void;
  /** True while any planet is mid-burst, anywhere in the sky. */
  hasActiveBurstFx(): boolean;

  milestoneTier(): number;
  orbitLegibility(): number;
  onPlanetSelect(planetId: string): void;
  /** Somebody tapped this member's sun. The sky decides what that means. */
  onSystemSelect(systemId: string): void;
  /**
   * The pointer entered or left something belonging to this member.
   *
   * **`null` on leave, and the coordinates are the canvas's.** The scene has no
   * text in it and is not gaining any: this exists so a *host* can draw a name
   * in the DOM, where it can be styled by the app, read by a screen reader and
   * positioned without a font atlas.
   */
  onSystemHover(systemId: string | null, x: number, y: number): void;

  /**
   * The reach changed without animating — the sky should refit now.
   */
  reachSettled(): void;
  /**
   * A refit is starting. The sky captures its own fit state and returns a
   * stepper it wants called on each frame of the animation.
   */
  beginReachAnimation(): (t: number) => void;
  /** The refit finished; the sky should settle its fit. */
  endReachAnimation(): void;

  /**
   * A planet is bursting. The sky spawns whatever it spawns and returns a
   * per-frame updater for it. Called once, at the start.
   */
  beginPlanetBurst(
    planetId: string,
    origin: { x: number; y: number },
    removed?: PlanetConfig,
  ): (t: number) => void;
};

export class SolarSystem {
  /** The container every node below belongs to. Added to the sky by `Galaxy`. */
  readonly root: Container;

  private sunConfig: SunConfig;
  private planets: PlanetConfig[];
  private dayClosed: boolean;

  /** `id → planet`, kept in step by `setData`. See `tick` for why it exists. */
  private readonly planetById = new Map<string, PlanetConfig>();

  private sun: Container | null = null;
  private orbits: OrbitBody[] = [];
  private orbitPaths: Container | null = null;
  private readonly orbitRingGraphics = new Map<string, Graphics>();
  private readonly orbitAmounts = new Map<string, number>();
  private readonly orbitRefit = new OrbitRefitCoordinator();
  private orbitWarmMs = 0;
  private displayGrowth = 0;

  /**
   * How strongly this system's planets are being pulled into line, 0 to 1.
   *
   * **The Circle-complete moment, and the one place the sky reaches into a
   * system's orbits.** Kept as a single number applied inside this class's own
   * tick rather than as the sky writing angles directly: the sky says *how
   * much*, the system decides what that means to its bodies.
   */
  private phaseAlign = 0;
  private phaseTarget = 0;

  /** Where the outermost orbit is, and where it is being drawn mid-refit. */
  private targetReach = 160;
  private displayReach = 160;

  /**
   * The member this system belongs to. **Every FX key this system creates is
   * scoped by it**, so two people's planets cannot cancel each other's
   * animations even if the host ever reuses a planet id.
   */
  readonly id: string;

  private readonly dayClosedFx: string;
  private readonly orbitRefitFx: string;

  constructor(
    private readonly host: SystemHost,
    data: {
      id: string;
      sun: SunConfig;
      planets: PlanetConfig[];
      dayClosed?: boolean;
    },
  ) {
    this.id = data.id;
    this.dayClosedFx = dayClosedKind(data.id);
    this.orbitRefitFx = orbitRefitKind(data.id);
    this.sunConfig = data.sun;
    this.planets = data.planets;
    this.dayClosed = Boolean(data.dayClosed);
    this.displayGrowth = data.sun.growth ?? 0.2;
    this.indexPlanets();

    this.root = new Container({ label: "system", sortableChildren: true });
    this.root.eventMode = "passive";

    this.build();
  }

  // ── data ──────────────────────────────────────────────────────────────────

  private indexPlanets(): void {
    this.planetById.clear();
    for (const planet of this.planets) {
      this.planetById.set(planet.id, planet);
    }
  }

  /** Replace the data without touching the scene. Callers then apply a diff. */
  setData(data: {
    sun: SunConfig;
    planets: PlanetConfig[];
    dayClosed?: boolean;
  }): void {
    this.sunConfig = data.sun;
    this.planets = data.planets;
    this.dayClosed = Boolean(data.dayClosed);
    this.indexPlanets();
  }

  planetConfig(planetId: string): PlanetConfig | undefined {
    return this.planetById.get(planetId);
  }

  /** This member's sun colour, for effects the sky draws on their behalf. */
  getSunColor(): number {
    return this.sunConfig.color;
  }

  /**
   * Pull this system's planets toward a shared angle.
   *
   * `amount` is 0 for normal orbiting and 1 for a full conjunction. The sky
   * passes every system the **same** target, so the whole Circle lines up
   * together — that is the difference between "each system tidied itself" and
   * "the Circle synchronised".
   */
  setPhaseAlignment(amount: number, targetAngle: number): void {
    this.phaseAlign = Math.max(0, Math.min(1, amount));
    this.phaseTarget = targetAngle;
  }

  /**
   * How big this sun is drawn, including its growth.
   *
   * The sky needs it to space systems: what must never happen is a neighbour's
   * planets reaching into this sun, and that distance is a sun radius, not an
   * orbit radius.
   */
  getSunDisplayRadius(): number {
    return (
      this.sunConfig.radius * SUN_DISPLAY_SCALE * (1 + this.displayGrowth * 0.75)
    );
  }

  getTargetReach(): number {
    return this.targetReach;
  }

  getDisplayReach(): number {
    return this.displayReach;
  }

  // ── build and teardown ────────────────────────────────────────────────────

  private build(): void {
    this.sun = createSun(
      this.sunConfig,
      this.host.shadeTexture,
      this.host.milestoneTier(),
      this.host.sunGlowTexture,
      this.host.sunRayTexture,
    );
    this.root.addChild(this.sun);
    this.bindSunSelect(this.sun);
    this.poseDayClosed(this.dayClosed);

    this.orbitAmounts.clear();
    for (const planet of this.planets) {
      this.orbitAmounts.set(planet.id, planet.shine ? 1 : 0);
    }

    const flatten = flattenFromTilt(this.host.view.tilt);
    this.orbits = this.planets.map((planet) => {
      const node = createPlanet(planet, flatten, this.host.shadeTexture);
      this.bindPlanetSelect(node, planet.id);
      this.root.addChild(node);
      return createOrbitBody(node, planet);
    });

    this.applyView();
    this.targetReach = nebulaReach(this.planets);
    this.displayReach = this.targetReach;
    this.applySunScale();
  }

  destroy(): void {
    this.orbitRefit.clear();
    this.orbitRingGraphics.clear();
    this.orbitAmounts.clear();
    this.orbits = [];
    this.orbitPaths = null;
    this.sun = null;
    if (!this.root.destroyed) {
      this.root.destroy({ children: true });
    }
  }

  // ── per-frame ─────────────────────────────────────────────────────────────

  tick(deltaMS: number, motion: boolean, elapsedMs: number): void {
    if (this.sun) {
      tickSunSurface(
        this.sun,
        deltaMS,
        motion ? orbitSpeedScale(this.orbitWarmMs) : 0,
        elapsedMs,
      );
    }
    this.applySunScale();

    if (!motion) {
      poseOrbits(this.orbits, this.host.view);
      return;
    }

    this.orbitWarmMs += deltaMS;
    const speedScale = orbitSpeedScale(this.orbitWarmMs);
    tickOrbits(this.orbits, deltaMS, this.host.view, speedScale);

    /**
     * **Applied after the orbits advance, not instead of them.** The planets
     * keep moving throughout; they are simply drawn toward a common angle and
     * released again, so the moment reads as the Circle falling into step
     * rather than as the animation being paused and posed.
     *
     * Angles are blended the short way round, or a planet a little past the
     * target would take the long route and visibly run backwards.
     */
    if (this.phaseAlign > 0) {
      for (const body of this.orbits) {
        let delta = this.phaseTarget - body.angle;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        body.angle += delta * this.phaseAlign;
      }
      poseOrbits(this.orbits, this.host.view);
    }

    /**
     * **`planetById`, not `planets.find`.** This loop ran a linear scan of the
     * planets array once per body, so the cost was quadratic in the number of
     * planets: a hundred comparisons a frame for one person's ten goals, and
     * ten thousand a frame for a Circle of ten sharing one canvas.
     */
    for (const body of this.orbits) {
      const planet = this.planetById.get(body.id);
      if (!planet) {
        continue;
      }
      tickPlanetSpin(
        body.container,
        planet,
        deltaMS,
        speedScale,
        body.spinSpeed,
      );
      tickPlanetSurface(body.container, planet, elapsedMs);
    }
  }

  // ── view ──────────────────────────────────────────────────────────────────

  applyView(): void {
    const flatten = flattenFromTilt(this.host.view.tilt);
    this.root.rotation = this.host.view.roll;
    this.syncOrbitPaths(flatten);
    this.applyBeltFlatten(flatten);
    poseOrbits(this.orbits, this.host.view);
    if (this.sun) {
      this.sun.zIndex = 0;
    }
  }

  private applyBeltFlatten(flatten: number): void {
    for (const body of this.orbits) {
      const belt = body.container.getChildByLabel("belt");
      if (belt instanceof Graphics) {
        setBeltFlatten(belt, flatten);
      }
    }
  }

  // ── sun ───────────────────────────────────────────────────────────────────

  replaceSun(): void {
    if (this.sun) {
      this.root.removeChild(this.sun);
      this.sun.destroy({ children: true });
    }
    this.sun = createSun(
      this.sunConfig,
      this.host.shadeTexture,
      this.host.milestoneTier(),
      this.host.sunGlowTexture,
      this.host.sunRayTexture,
    );
    this.root.addChild(this.sun);
    this.bindSunSelect(this.sun);
    this.displayGrowth = this.sunConfig.growth ?? 0.2;
    this.applySunScale();
    this.poseDayClosed(this.dayClosed);
  }

  private applySunScale(): void {
    if (!this.sun) {
      return;
    }
    const growth = this.sunConfig.growth ?? 0.2;
    this.displayGrowth = growth;
    this.sun.scale.set(SUN_DISPLAY_SCALE * (1 + this.displayGrowth * 0.75));
  }

  setSunGrowth(growth: number): void {
    this.sunConfig = {
      ...this.sunConfig,
      growth: Math.min(1, Math.max(0, growth)),
    };
    this.displayGrowth = this.sunConfig.growth ?? 0.2;
    this.applySunScale();
  }

  // ── day closed ────────────────────────────────────────────────────────────

  private poseDayClosed(closed: boolean, swell = 0): void {
    if (!this.sun) {
      return;
    }
    poseSunCorona(this.sun, closed, swell);
    if (!closed) {
      this.clearDayClosedPulse();
    }
  }

  easeDayOpen(): void {
    if (this.host.reducedMotion) {
      this.poseDayClosed(false);
      return;
    }
    this.host.cancelFx(this.dayClosedFx);
    this.clearDayClosedPulse();
    this.host.playFx(
      FX_DAY_CLOSED_MS,
      (t) => {
        if (this.dayClosed || !this.sun) {
          return;
        }
        poseSunCoronaAt(this.sun, 1 - t, 0);
      },
      () => {
        this.clearDayClosedPulse();
        this.poseDayClosed(false);
      },
      this.dayClosedFx,
    );
  }

  swellDayClosed(): void {
    if (this.host.reducedMotion) {
      this.poseDayClosed(true);
      return;
    }
    this.host.cancelFx(this.dayClosedFx);
    this.clearDayClosedPulse();
    const pulse = new Graphics({ label: "day-closed-pulse" });
    pulse.blendMode = "add";
    pulse.eventMode = "none";
    pulse.zIndex = 400;
    this.root.addChild(pulse);
    const color = this.sunConfig.color;
    this.host.playFx(
      FX_DAY_CLOSED_MS,
      (t) => {
        if (!this.dayClosed || pulse.destroyed) {
          return;
        }
        const peak = t < 0.38 ? t / 0.38 : 1 - (t - 0.38) / 0.62;
        this.poseDayClosed(true, peak);
        pulse.clear();
        const sunReach = this.sunConfig.radius * SUN_DISPLAY_SCALE;
        const radius = sunReach * (0.75 + t * 5.5);
        const fade = 1 - t;
        pulse.circle(0, 0, radius).fill({ color, alpha: 0.06 * fade });
        pulse.circle(0, 0, radius * 0.72).fill({ color, alpha: 0.04 * fade });
        pulse
          .circle(0, 0, radius * 0.45)
          .fill({ color, alpha: 0.09 * fade * fade });
      },
      () => {
        this.clearDayClosedPulse();
        this.poseDayClosed(this.dayClosed);
      },
      this.dayClosedFx,
    );
  }

  private clearDayClosedPulse(): void {
    const pulse = this.root.getChildByLabel("day-closed-pulse");
    if (!pulse) {
      return;
    }
    this.root.removeChild(pulse);
    pulse.destroy();
  }

  // ── orbit rings ───────────────────────────────────────────────────────────

  private orbitRingFor(planetId: string): OrbitRing | null {
    const planet = this.planetById.get(planetId);
    if (!planet) {
      return null;
    }
    return {
      id: planet.id,
      radius: planet.orbitRadius,
      color: planet.color,
      shine: planet.shine,
    };
  }

  private orbitBodyFor(planetId: string): OrbitBody | undefined {
    return this.orbits.find((item) => item.id === planetId);
  }

  private syncOrbitPaths(flatten: number): void {
    if (!this.orbitPaths) {
      this.orbitPaths = new Container({ label: "orbit-paths" });
      this.orbitPaths.eventMode = "none";
      this.orbitPaths.zIndex = -1000;
      this.root.addChildAt(this.orbitPaths, 0);
    }

    const activeIds = new Set(this.planets.map((planet) => planet.id));
    for (const [id, graphic] of this.orbitRingGraphics) {
      if (activeIds.has(id) || this.host.hasFx(burstKind(this.id, id))) {
        continue;
      }
      this.orbitPaths.removeChild(graphic);
      graphic.destroy();
      this.orbitRingGraphics.delete(id);
    }

    for (const planet of this.planets) {
      let graphic = this.orbitRingGraphics.get(planet.id);
      if (!graphic) {
        graphic = new Graphics({ label: `orbit-ring-${planet.id}` });
        graphic.eventMode = "none";
        this.orbitPaths.addChild(graphic);
        this.orbitRingGraphics.set(planet.id, graphic);
      }
      this.paintOrbitRingGraphic(planet.id, flatten);
    }
  }

  private paintOrbitRingGraphic(planetId: string, flatten: number): void {
    const ring = this.orbitRingFor(planetId);
    const graphic = this.orbitRingGraphics.get(planetId);
    const body = this.orbitBodyFor(planetId);
    if (!ring || !graphic) {
      return;
    }
    const radius = body ? effectiveOrbitRadius(body) : ring.radius;
    paintOrbitRingAtRadius(
      graphic,
      ring,
      flatten,
      radius,
      this.orbitAmounts.get(planetId) ?? (ring.shine ? 1 : 0),
      this.host.orbitLegibility(),
    );
  }

  private paintAllOrbitRings(flatten: number): void {
    for (const planet of this.planets) {
      this.paintOrbitRingGraphic(planet.id, flatten);
    }
  }

  private paintOrbitAmount(planet: PlanetConfig, light: number): void {
    const amount = Math.min(1, Math.max(0, light));
    this.orbitAmounts.set(planet.id, amount);
    this.paintOrbitRingGraphic(planet.id, flattenFromTilt(this.host.view.tilt));
  }

  /** Reset every ring's light to match the data, before FX reintroduce it. */
  resetOrbitAmounts(overrides?: {
    shineStarting?: readonly string[];
    dimStarting?: readonly string[];
  }): void {
    this.orbitAmounts.clear();
    for (const planet of this.planets) {
      this.orbitAmounts.set(planet.id, planet.shine ? 1 : 0);
    }
    for (const planetId of overrides?.shineStarting ?? []) {
      this.orbitAmounts.set(planetId, 0);
    }
    for (const planetId of overrides?.dimStarting ?? []) {
      this.orbitAmounts.set(planetId, 1);
    }
  }

  // ── orbit refit ───────────────────────────────────────────────────────────

  scheduleOrbitRefit(
    targets: ReadonlyMap<string, number>,
    burstIds: readonly string[],
    nextReach: number,
  ): void {
    this.snapInFlightOrbitRefit();
    const schedule = this.orbitRefit.schedule(
      targets,
      burstIds,
      this.displayReach,
      nextReach,
      (planetId) => {
        const body = this.orbitBodyFor(planetId);
        return body ? effectiveOrbitRadius(body) : undefined;
      },
    );
    this.targetReach = nextReach;
    if (schedule === "immediate") {
      this.startOrbitRefit();
    }
  }

  snapOrbitTargets(
    targets: ReadonlyMap<string, number>,
    nextReach: number,
  ): void {
    this.orbitRefit.clear();
    for (const body of this.orbits) {
      const nextRadius = targets.get(body.id);
      if (nextRadius !== undefined) {
        body.orbitRadius = nextRadius;
      }
    }
    snapOrbitRadii(this.orbits, targets);
    this.targetReach = nextReach;
    this.paintAllOrbitRings(flattenFromTilt(this.host.view.tilt));
  }

  isWaitingForBurst(): boolean {
    return this.orbitRefit.isWaitingForBurst();
  }

  private snapInFlightOrbitRefit(): void {
    if (!this.host.hasFx(this.orbitRefitFx)) {
      return;
    }
    this.host.cancelFx(this.orbitRefitFx);
    const targets = this.orbitRefit.toById();
    if (targets.size > 0) {
      snapOrbitRadii(this.orbits, targets);
    } else {
      snapOrbitRadii(this.orbits);
    }
    this.paintAllOrbitRings(flattenFromTilt(this.host.view.tilt));
  }

  maybeStartPendingOrbitRefit(): void {
    if (this.host.hasFx(this.orbitRefitFx)) {
      return;
    }
    if (!this.orbitRefit.shouldStartRefit() || this.host.hasActiveBurstFx()) {
      return;
    }
    this.startOrbitRefit();
  }

  private startOrbitRefit(): void {
    if (this.host.hasFx(this.orbitRefitFx)) {
      return;
    }

    const fromRadii = this.orbitRefit.fromById();
    const toRadii = this.orbitRefit.toById();
    if (fromRadii.size === 0 || toRadii.size === 0) {
      return;
    }

    this.targetReach = this.orbitRefit.reachTo();

    if (this.host.reducedMotion) {
      snapOrbitRadii(this.orbits, toRadii);
      this.displayReach = this.targetReach;
      this.host.reachSettled();
      poseOrbits(this.orbits, this.host.view);
      this.paintAllOrbitRings(flattenFromTilt(this.host.view.tilt));
      this.orbitRefit.complete();
      return;
    }

    this.host.cancelFx(this.orbitRefitFx);

    const flatten = flattenFromTilt(this.host.view.tilt);
    const stepFit = this.host.beginReachAnimation();
    const refitFromReach = this.orbitRefit.reachFrom();
    const refitToReach = this.orbitRefit.reachTo();

    const stepRefit = (t: number): void => {
      lerpOrbitRadii(this.orbits, fromRadii, t, toRadii);
      this.displayReach = refitFromReach + (refitToReach - refitFromReach) * t;
      this.paintAllOrbitRings(flatten);
      poseOrbits(this.orbits, this.host.view);
      stepFit(t);
    };

    stepRefit(0);

    this.host.playFx(
      ORBIT_REFIT_MS,
      stepRefit,
      () => {
        snapOrbitRadii(this.orbits, toRadii);
        this.displayReach = this.targetReach;
        this.orbitRefit.complete();
        this.host.endReachAnimation();
        this.paintAllOrbitRings(flatten);
        poseOrbits(this.orbits, this.host.view);
      },
      this.orbitRefitFx,
    );
  }

  /** Recompute the reach from the current planets, without animating. */
  refreshReach(animatingRefit: boolean): void {
    const reach = nebulaReach(this.planets);
    this.targetReach = reach;
    if (animatingRefit && !this.host.reducedMotion) {
      return;
    }
    this.displayReach = reach;
    this.host.reachSettled();
  }

  // ── planets ───────────────────────────────────────────────────────────────

  planetWrap(planetId: string): Container | null {
    const wrap = this.root.getChildByLabel(`planet-${planetId}`, true);
    return wrap instanceof Container ? wrap : null;
  }

  /**
   * Make the sun tappable, so a Circle can be read one member at a time.
   *
   * **A hit circle rather than the sun's own art.** The corona and flares are
   * `blendMode: "add"` sprites several times the sun's radius, so hit-testing
   * them would swallow taps well outside anything that looks like the sun —
   * and in a tight cluster that means stealing them from the neighbour.
   */
  private bindSunSelect(sun: Container): void {
    const hit = new Graphics({ label: `sun-body-${this.id}` });
    hit
      .circle(0, 0, this.sunConfig.radius * 1.15)
      .fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.zIndex = 500;
    hit.on("pointertap", (event) => {
      event.stopPropagation();
      this.host.onSystemSelect(this.id);
    });
    this.bindSystemHover(hit);
    sun.addChild(hit);
  }

  private bindPlanetSelect(node: Container, planetId: string): void {
    const body = node.getChildByLabel(`planet-body-${planetId}`, true);
    if (!body) {
      return;
    }
    body.on("pointertap", (event) => {
      event.stopPropagation();
      this.host.onPlanetSelect(planetId);
    });
    this.bindSystemHover(body);
  }

  /**
   * Enter and leave, reported with the pointer's position.
   *
   * **On the planets as well as the sun**, because in a Circle the planets are
   * what a cursor lands on: the sun is one small disc and the orbits are wide.
   * Both answer with the same member, so hovering anywhere in somebody's system
   * says whose it is.
   *
   * `pointerover`/`pointerout` rather than `pointerenter`/`pointerleave`: Pixi's
   * federated events model the first pair, and the bubbling difference does not
   * arise here because these are leaf hit targets.
   *
   * ## And `pointertap`, which is the one a finger can rely on
   *
   * **Over and out are a mouse's vocabulary.** What a touch screen synthesises
   * around a tap varies by browser and by whether the gesture was claimed
   * mid-flight, and a name that appears on a desktop and not on a phone is
   * exactly what was reported — twice, once after a fix aimed at the host
   * rather than at here.
   *
   * `pointertap` is not synthesised: it is the event `bindPlanetSelect` and
   * `bindSunSelect` already use, so it demonstrably fires on this hardware for
   * these very nodes. Binding the name to it makes a tap say whose system this
   * is even on a Circle, where **a planet tap has no other job** — those are
   * other people's goals and there is nowhere to navigate.
   *
   * On a mouse it fires on click and re-announces a name already on screen,
   * which costs a `setState` with the same values and shows nothing new.
   */
  private bindSystemHover(node: Container): void {
    node.eventMode = "static";
    node.on("pointerover", (event) => {
      this.host.onSystemHover(this.id, event.global.x, event.global.y);
    });
    node.on("pointertap", (event) => {
      this.host.onSystemHover(this.id, event.global.x, event.global.y);
    });
    node.on("pointerout", () => {
      this.host.onSystemHover(null, 0, 0);
    });
  }

  addPlanetNode(planet: PlanetConfig, appear: boolean): void {
    const flatten = flattenFromTilt(this.host.view.tilt);
    const node = createPlanet(planet, flatten, this.host.shadeTexture);
    this.bindPlanetSelect(node, planet.id);
    this.root.addChild(node);
    const body = createOrbitBody(node, planet);
    this.orbits.push(body);
    poseOrbits([body], this.host.view);
    if (!appear) {
      return;
    }
    body.appearScale = 0.2;
    node.alpha = 0;
    this.host.playFx(
      FX_APPEAR_MS,
      (t) => {
        if (node.destroyed) {
          return;
        }
        node.alpha = t;
        body.appearScale = 0.2 + 0.8 * t;
        poseOrbits([body], this.host.view);
      },
      () => {
        if (node.destroyed) {
          return;
        }
        node.alpha = 1;
        body.appearScale = 1;
        poseOrbits([body], this.host.view);
      },
      appearKind(this.id, planet.id),
    );
  }

  replacePlanetNode(planet: PlanetConfig): void {
    const existing = this.orbitBodyFor(planet.id);
    const angle = existing?.angle ?? planet.phase;
    this.detachPlanet(planet.id);
    this.addPlanetNode(planet, false);
    const next = this.orbitBodyFor(planet.id);
    if (!next) {
      return;
    }
    next.angle = angle;
    if (this.host.reducedMotion) {
      return;
    }
    const node = next.container;
    node.alpha = 0.55;
    this.host.playFx(
      260,
      (t) => {
        if (node.destroyed) {
          return;
        }
        node.alpha = 0.55 + 0.45 * t;
      },
      () => {
        if (!node.destroyed) {
          node.alpha = 1;
        }
      },
      `cosmetic:${this.id}:${planet.id}`,
    );
  }

  removePlanet(planetId: string, removed?: PlanetConfig): void {
    const body = this.orbitBodyFor(planetId);
    if (!body) {
      return;
    }
    const origin = body.container.getGlobalPosition();
    const stepBurst = this.host.beginPlanetBurst(planetId, origin, removed);

    body.container.eventMode = "none";
    const ringGraphic = this.orbitRingGraphics.get(planetId);
    const ringRadius = effectiveOrbitRadius(body);
    const flatten = flattenFromTilt(this.host.view.tilt);
    const ringShine =
      this.orbitAmounts.get(planetId) ?? (removed?.shine ? 1 : 0);
    if (ringGraphic) {
      ringGraphic.alpha = 1;
    }
    this.host.playFx(
      FX_BURST_MS,
      (t) => {
        if (body.container.destroyed) {
          return;
        }
        const fade = 1 - t;
        body.container.alpha = fade;
        body.appearScale = 1 - 0.4 * t;
        if (ringGraphic && removed) {
          ringGraphic.alpha = fade;
          paintOrbitRingAtRadius(
            ringGraphic,
            {
              id: planetId,
              radius: ringRadius,
              color: removed.color,
              shine: removed.shine,
            },
            flatten,
            ringRadius,
            ringShine * fade,
            this.host.orbitLegibility(),
          );
        } else if (ringGraphic) {
          ringGraphic.alpha = fade;
        }
        stepBurst(t);
        poseOrbits([body], this.host.view);
      },
      () => {
        stepBurst(1);
        this.detachPlanet(planetId);
        this.orbitRefit.burstFinished(planetId);
        this.maybeStartPendingOrbitRefit();
      },
      burstKind(this.id, planetId),
    );
  }

  private detachPlanet(planetId: string): void {
    const index = this.orbits.findIndex((body) => body.id === planetId);
    if (index < 0) {
      return;
    }
    const [body] = this.orbits.splice(index, 1);
    if (!body) {
      return;
    }
    this.root.removeChild(body.container);
    body.container.destroy({ children: true });
    const graphic = this.orbitRingGraphics.get(planetId);
    if (graphic && this.orbitPaths) {
      this.orbitPaths.removeChild(graphic);
      graphic.destroy();
    }
    this.orbitRingGraphics.delete(planetId);
  }

  // ── shine ─────────────────────────────────────────────────────────────────

  pulseShine(planet: PlanetConfig): void {
    const wrap = this.planetWrap(planet.id);
    if (!wrap) {
      return;
    }
    const flatten = flattenFromTilt(this.host.view.tilt);
    this.host.playFx(
      FX_SHINE_MS,
      (t) => {
        if (wrap.destroyed) {
          return;
        }
        const light = shineLight(t);
        paintPlanetLook(wrap, planet, true, undefined, light);
        paintBeltLook(wrap, planet, light, flatten);
        this.paintOrbitAmount(planet, light);
      },
      () => {
        if (wrap.destroyed) {
          return;
        }
        paintPlanetLook(wrap, planet, true);
        paintBeltLook(wrap, planet, 1, flatten);
        this.paintOrbitAmount(planet, 1);
      },
      shineKind(this.id, planet.id),
    );
  }

  pulseDim(planet: PlanetConfig): void {
    const wrap = this.planetWrap(planet.id);
    if (!wrap) {
      return;
    }
    const flatten = flattenFromTilt(this.host.view.tilt);
    this.host.playFx(
      FX_SHINE_MS,
      (t) => {
        if (wrap.destroyed) {
          return;
        }
        const light = dimLight(t);
        paintPlanetLook(wrap, planet, false, undefined, light);
        paintBeltLook(wrap, planet, light, flatten);
        this.paintOrbitAmount(planet, light);
      },
      () => {
        if (wrap.destroyed) {
          return;
        }
        paintPlanetLook(wrap, planet, false);
        paintBeltLook(wrap, planet, 0, flatten);
        this.paintOrbitAmount(planet, 0);
      },
      shineKind(this.id, planet.id),
    );
  }

  // ── belts ─────────────────────────────────────────────────────────────────

  setBeltVisible(planetId: string, visible: boolean): void {
    const planet = this.planetById.get(planetId);
    if (!planet) {
      return;
    }
    planet.beltVisible = visible;
    const wrap = this.planetWrap(planetId);
    if (!wrap) {
      return;
    }
    const existing = wrap.getChildByLabel("belt");
    if (!visible) {
      if (existing) {
        existing.visible = false;
      }
      return;
    }
    if (existing) {
      existing.visible = true;
      return;
    }
    const belt = planet.belt ?? {
      color: planet.color,
      innerRadius: planet.radius + 5,
      outerRadius: planet.radius + 11,
    };
    planet.belt = belt;
    wrap.addChild(
      createBelt(belt, flattenFromTilt(this.host.view.tilt), planet.shine ? 1 : 0),
    );
  }
}
