import { Container, Graphics, Rectangle } from "pixi.js";
import type { Particle } from "pixi.js";
import {
  COMPACT_ORBIT_LEGIBILITY,
  COMPACT_STAR_SCALE,
  CAMERA_AUTOFIT_PAN_THRESHOLD,
  CAMERA_AUTOFIT_ZOOM_EPSILON,
  CAMERA_FIT_MS,
  DEFAULT_COMPACT_TILT,
  DEFAULT_COMPACT_YAW,
  DEFAULT_ROLL,
  DEFAULT_STAR_CAP,
  DEFAULT_TILT,
  DEFAULT_YAW,
  FX_BURST_MS,
  FX_DAY_CLOSED_MS,
  FX_NEBULA_MS,
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
  isCompactLayout,
} from "../constants";
import { createSphereShadeTexture } from "../render/sphereShade";
import { createSunGlowTexture, createSunRayTexture } from "../render/sunTexture";
import { createStarTexture } from "../render/starTexture";
import {
  clusterReach,
  clusterRingLegibility,
  clusterSlot,
  clusterSystemScale,
} from "../systems/clusterLayout";
import { diffSnapshot } from "../systems/diffSnapshot";
import {
  coreSpinFor,
  nebulaSpinFor,
  starfieldSpinFor,
} from "../systems/skyBackdrop";
import { FxQueue } from "../systems/fxQueue";
import { nebulaReach, nebulaSignature } from "../systems/nebulaClusters";
import {
  CAMERA_FIT_KIND,
  NEBULA_BIRTH_KIND,
  planSnapshotFx,
  SKY_CLOSED_KIND,
  type SystemFxPlan,
} from "../systems/planSnapshotFx";
import { clampTilt } from "../systems/OrbitSystem";
import {
  achievementTier,
  milestoneTwinkleBoost,
} from "../systems/starMilestones";
import type {
  GalaxyCamera,
  GalaxySnapshot,
  PlanetConfig,
  StarConfig,
  SystemConfig,
  ViewRotation,
} from "../types";
import { createNebula, tickNebula } from "./Nebula";
import { playAchieveCelebration } from "./planetSurfaceMotion";
import { galaxyPaletteFor } from "../galaxyPalette";
import { GalacticCore } from "./GalacticCore";
import {
  CONVERGENCE_MAX,
  clearSkyBridges,
  convergenceAt,
  createSkyBridges,
  paintSkyBridges,
} from "./SkyBridges";
import { SolarSystem, type SystemHost } from "./SolarSystem";
import { Starfield } from "./Starfield";
import { SkyAmbience } from "./SkyAmbience";

type GalaxyOptions = {
  snapshot: GalaxySnapshot;
  width: number;
  height: number;
  starCap?: number;
  reducedMotion: boolean;
  view?: Partial<ViewRotation>;
  onPlanetSelect?: (planetId: string) => void;
  onSystemSelect?: (systemId: string) => void;
  onSystemHover?: (systemId: string | null, x: number, y: number) => void;
  /**
   * The data behind this sky stopped changing at some past instant.
   *
   * **A separate option from `reducedMotion` even though the effect is the
   * same**, because they are different claims: one is a person's preference
   * about animation, the other is a fact about the rows. Naming a frozen
   * Circle "reduced motion" would make the next person reading `tick` believe
   * an accessibility setting was involved.
   */
  frozen?: boolean;
  previewNebula?: boolean;
  compact?: boolean;
  starScale?: number;
  ambientEffects?: boolean;
};

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * How much clear space a system keeps around its sun, as a multiple of that
 * sun's own drawn radius.
 *
 * ## This replaced a multiplier, and the multiplier was asking the wrong thing
 *
 * Spacing used to be a multiple of a system's **orbit** radius, which forced a
 * choice between two bad pictures. Below `2.0` the systems genuinely overlapped
 * and one member's planets ran through another's sun. At `2.15` nothing
 * overlapped and **the suns were pushed much too far apart** — because it was
 * separating the *outermost orbits*, and those are thin, dim ellipses that
 * carry almost none of a system's visual weight.
 *
 * **Orbit ellipses crossing is fine.** Two faint rings overlapping reads as a
 * cluster; it is what a real field of systems looks like. What is not fine is a
 * planet passing through somebody's sun, which is the collision that was
 * actually reported.
 *
 * So the rule is stated as the thing that matters: **a neighbour's outermost
 * planet clears this sun by `SUN_CLEARANCE` sun-radii.** The spacing falls out
 * of the geometry rather than being tuned, and it is far tighter than orbit
 * separation because a sun is small next to the orbits around it.
 *
 * At `2.5`, a ten-goal system leaves roughly a sun-and-a-half of dark space
 * between the furthest planet and the next sun — close enough to read as one
 * group, clear enough that nothing looks like it is about to hit anything.
 */
const SUN_CLEARANCE = 2.5;

/**
 * The sky: everything that belongs to the canvas rather than to a person.
 *
 * ## Two tiers, one of which repeats
 *
 * The starfield and the ambience belong to the canvas. The sun, its planets,
 * their orbit rings and the refit belong to **one person** — and that
 * distinction was invisible while there was exactly one person to belong to.
 *
 * `SolarSystem` is that second tier and this class holds any number of them,
 * keyed by member id. **Nothing here may reach past `SolarSystem`'s public
 * surface**, because the day it does is the day the count stops being free.
 *
 * ## The scene graph
 *
 * ```
 * root
 * ├─ skyAmbience        canvas-level motion
 * ├─ starfield          canvas coordinates, never per system
 * └─ cluster            ← the camera transforms this, once
 *    ├─ nebula          background for the whole sky
 *    └─ system × n      each at its own slot, each scaled to fit the cluster
 * ```
 *
 * **The camera moves `cluster`, not each system.** One transform however many
 * members there are, and it is what keeps a system's own position meaningful:
 * a system is placed by the layout and never by the camera.
 *
 * ## What stayed here, deliberately
 *
 * **The camera and the fit.** One canvas, one camera, and a fit that has to
 * frame every system at once rather than any one of them.
 *
 * **The achieve burst.** It spawns stars into the starfield, a burst into the
 * ambience, and a ring on this root. A system contributes the origin and its
 * own fade; the sky does the rest, through `beginPlanetBurst`.
 *
 * **The nebula**, which is now a child of `cluster` rather than of a system.
 * With ten systems it is background for the sky, and background belongs to the
 * sky. For a single system at the centre slot the picture is unchanged.
 */
export class Galaxy {
  readonly root: Container;

  private snapshot: GalaxySnapshot;
  private width: number;
  private height: number;
  private readonly starCap: number;
  private readonly reducedMotion: boolean;
  private readonly starTexture = createStarTexture();
  private readonly shadeTexture = createSphereShadeTexture();
  private readonly sunGlowTexture = createSunGlowTexture();
  private readonly sunRayTexture = createSunRayTexture();
  private readonly view: ViewRotation;
  private onPlanetSelect?: (planetId: string) => void;
  private onSystemSelect?: (systemId: string) => void;
  private onSystemHover?: (systemId: string | null, x: number, y: number) => void;
  private readonly frozen: boolean;
  private previewNebula: boolean;
  /**
   * **Fixed at mount, not re-derived on resize.**
   *
   * It selects a projection — full size tilts the system at 0.95, compact at
   * 0.5 — so re-deriving it from the live viewport made a desktop split pane
   * squash the galaxy flat every time it crossed 420px. It is a fact about
   * which surface this is, and a surface does not change under a drag.
   */
  private readonly compact: boolean;
  private readonly starScale: number;
  private ambientEffects: boolean;
  private starfield: Starfield | null = null;
  private skyAmbience: SkyAmbience | null = null;

  /**
   * Every member's system, keyed by id. **Insertion order is join order**,
   * which is what the layout indexes by — see `placeSystems`.
   */
  private readonly systems = new Map<string, SolarSystem>();
  private cluster: Container | null = null;

  private elapsedMs = 0;
  private nebulaSignature: string | null = null;
  private readonly nebulaLayoutSeed =
    (Math.imul(Date.now() ^ 0x6c8e9cf5, 0x9e3779b1) >>> 0) || 1;
  private readonly fx = new FxQueue();
  private baseFitScale = 1;
  private displayBaseFitScale = 1;
  private clusterReachValue = 160;
  private cameraInteracting = false;
  private camera: GalaxyCamera = { panX: 0, panY: 0, zoom: 1 };
  /** The member the camera is framing, or `null` for the whole Circle. */
  private focusedId: string | null = null;
  /** Radians per second for the nebula layer. Counter to the starfield. */
  private nebulaSpin = 0;
  /** The light between the suns when every member has finished. */
  private bridges: Graphics | null = null;
  /** What the Circle turns around. Absent for a personal galaxy. */
  private core: GalacticCore | null = null;
  private coreSpin = 0;
  /** Which blend the core was built with, so it is only rebuilt on a change. */
  private corePaletteId: string | null = null;
  /** How far the cluster is currently drawn in, 0 to `CONVERGENCE_MAX`. */
  private convergence = 0;
  private readonly host: SystemHost;

  constructor(opts: GalaxyOptions) {
    this.snapshot = opts.snapshot;
    this.width = opts.width;
    this.height = opts.height;
    this.starCap = opts.starCap ?? DEFAULT_STAR_CAP;
    this.reducedMotion = opts.reducedMotion;
    this.onPlanetSelect = opts.onPlanetSelect;
    this.onSystemSelect = opts.onSystemSelect;
    this.onSystemHover = opts.onSystemHover;
    this.frozen = opts.frozen ?? false;
    this.previewNebula = opts.previewNebula ?? false;
    this.compact = opts.compact ?? isCompactLayout(opts.width, opts.height);
    this.starScale = opts.starScale ?? (this.compact ? COMPACT_STAR_SCALE : 1);
    this.ambientEffects = opts.ambientEffects ?? true;
    this.view = {
      yaw: opts.view?.yaw ?? (this.compact ? DEFAULT_COMPACT_YAW : DEFAULT_YAW),
      tilt: clampTilt(
        opts.view?.tilt ?? (this.compact ? DEFAULT_COMPACT_TILT : DEFAULT_TILT),
      ),
      roll: opts.view?.roll ?? DEFAULT_ROLL,
    };
    this.root = new Container({ label: "galaxy", isRenderGroup: true });
    this.root.eventMode = "static";
    this.root.cursor = "grab";
    this.root.hitArea = new Rectangle(0, 0, opts.width, opts.height);
    this.host = this.makeHost();
    this.rebuild();
  }

  // ── what a SolarSystem is allowed to ask of the sky ───────────────────────

  /**
   * **Built in the constructor, not as a field initializer.** Field
   * initializers run before the constructor body, so `view`, `reducedMotion`
   * and the textures would all have been captured as `undefined` — and
   * `reducedMotion: undefined` is falsy, so every system would have animated
   * in a reduced-motion context with nothing failing to say so.
   */
  private makeHost(): SystemHost {
    return {
      view: this.view,
      reducedMotion: this.reducedMotion,
      shadeTexture: this.shadeTexture,
      sunGlowTexture: this.sunGlowTexture,
      sunRayTexture: this.sunRayTexture,
      playFx: (duration, update, finish, kind) =>
        this.playFx(duration, update, finish, kind),
      hasFx: (kind) => this.fx.has(kind),
      cancelFx: (kind) => this.fx.cancel(kind),
      hasActiveBurstFx: () => this.hasActiveBurstFx(),
      milestoneTier: () => this.milestoneTier(),
      orbitLegibility: () => this.orbitLegibility(),
      onPlanetSelect: (planetId) => this.onPlanetSelect?.(planetId),
      onSystemSelect: (systemId) => this.onSystemSelect?.(systemId),
      onSystemHover: (systemId, x, y) => this.onSystemHover?.(systemId, x, y),
      reachSettled: () => this.reachSettled(),
      beginReachAnimation: () => this.beginReachAnimation(),
      endReachAnimation: () => this.endReachAnimation(),
      beginPlanetBurst: (planetId, origin, removed) =>
        this.beginPlanetBurst(planetId, origin, removed),
    };
  }

  setOnPlanetSelect(handler?: (planetId: string) => void): void {
    this.onPlanetSelect = handler;
  }

  setOnSystemSelect(handler?: (systemId: string) => void): void {
    this.onSystemSelect = handler;
  }

  private nebulaPreviewActive(): boolean {
    return this.previewNebula || Boolean(this.snapshot.nebulaPreview);
  }

  /**
   * The ambience tier. **The host's value wins when it supplies one**, because
   * `achievementCount` summed across a Circle reaches the top tier within a
   * week and then never moves again.
   */
  private milestoneTier(): number {
    return (
      this.snapshot.ambienceTier ??
      achievementTier(this.snapshot.achievementCount ?? 0)
    );
  }

  /**
   * How heavily orbit rings are drawn.
   *
   * Compact hosts get them **stronger** (the panel is small), and clusters get
   * them **weaker** — a hundred ellipses at cluster scale is a lot of line for
   * not much information. The two multiply, because a compact Circle panel is
   * both at once.
   */
  private orbitLegibility(): number {
    const compact = this.compact ? COMPACT_ORBIT_LEGIBILITY : 1;
    return compact * clusterRingLegibility(this.systems.size);
  }

  private hasActiveBurstFx(): boolean {
    return this.fx.kinds().some((kind) => kind.startsWith("burst:"));
  }

  setPreviewNebula(enabled: boolean): void {
    this.previewNebula = enabled;
    this.replaceNebula();
  }

  setAmbientEffects(enabled: boolean): void {
    this.ambientEffects = enabled;
    this.skyAmbience?.setEnabled(enabled);
  }

  // ── snapshot ──────────────────────────────────────────────────────────────

  setSnapshot(next: GalaxySnapshot): void {
    const prevTier = this.milestoneTier();
    const diff = diffSnapshot(this.snapshot, next);
    const plan = planSnapshotFx(diff);
    this.fx.cancelMany(plan.cancel);
    this.snapshot = next;

    if (!this.cluster || !this.starfield) {
      this.rebuild();
      return;
    }

    /**
     * **A member joining or leaving is incremental, not a rebuild.**
     * Rebuilding would restart every other member's orbits from their starting
     * phase, which reads as the screen glitching because a stranger arrived.
     */
    for (const removed of diff.removedSystems) {
      this.removeSystem(removed.id);
    }
    for (const added of diff.addedSystems) {
      this.addSystem(added);
    }

    const nextTier = this.milestoneTier();
    if (nextTier !== prevTier) {
      this.skyAmbience?.setTier(nextTier);
    }

    // Keep every system's data current, changed or not: the diff tells us what
    // to animate, but a system still has to know what it now holds.
    for (const config of next.systems) {
      this.systems.get(config.id)?.setData({
        sun: config.sun,
        planets: config.planets,
        dayClosed: config.dayClosed,
      });
    }

    if (diff.starsReplaced) {
      this.starfield.replaceStars(next.stars.slice(0, this.starCap));
    }

    const configById = new Map(
      next.systems.map((config) => [config.id, config] as const),
    );
    const planById = new Map(
      plan.systems.map((entry) => [entry.systemId, entry] as const),
    );

    let leftoverStars = diff.starsReplaced ? [] : [...diff.appendedStars];

    /**
     * **Only changed systems are walked.** A quiet member is not in the diff
     * at all, so this loop is one iteration when one person checks in — not
     * ten with nine no-ops. That is the property the whole Circle galaxy's
     * update cost rests on.
     */
    for (const systemDiff of diff.systems) {
      const system = this.systems.get(systemDiff.systemId);
      const config = configById.get(systemDiff.systemId);
      const systemPlan = planById.get(systemDiff.systemId);
      if (!system || !config) {
        continue;
      }

      if (systemDiff.sunChanged) {
        system.replaceSun();
      }

      for (const removed of systemDiff.removedPlanets) {
        if (diff.starsReplaced) {
          this.burstStars = [];
          system.removePlanet(removed.id, removed);
          continue;
        }
        const matching = leftoverStars.filter(
          (star) => star.color === removed.color,
        );
        leftoverStars = leftoverStars.filter(
          (star) => star.color !== removed.color,
        );
        this.burstStars = matching;
        system.removePlanet(removed.id, removed);
      }
      this.burstStars = [];

      for (const planet of systemDiff.updatedPlanets) {
        system.replacePlanetNode(planet);
      }
      for (const planet of systemDiff.addedPlanets) {
        system.addPlanetNode(planet, true);
      }

      if (systemPlan) {
        this.applySystemPlan(system, config, systemPlan);
      }
    }

    if (leftoverStars.length > 0) {
      this.starfield.addStars(leftoverStars);
    }

    // A tier change repaints every sun, and is rare enough to be worth the
    // sweep. It is not in any system's diff because it is a sky-level fact.
    if (nextTier !== prevTier) {
      for (const [id, system] of this.systems) {
        if (!diff.systems.some((entry) => entry.systemId === id)) {
          system.replaceSun();
        }
      }
    }

    if (plan.startSkyClosed) {
      this.playSkyClosed();
    }
    if (plan.startSkyOpen) {
      this.clearSkyClosed();
    }

    this.replaceNebula();
    this.placeSystems();
    this.applyBackdropSpin();
    this.applyView();
    this.settleReach(
      plan.systems.some((entry) => entry.startOrbitRefit),
    );

    for (const systemDiff of diff.systems) {
      const system = this.systems.get(systemDiff.systemId);
      const systemPlan = planById.get(systemDiff.systemId);
      if (!system || !systemPlan) {
        continue;
      }
      for (const planetId of systemPlan.startShine) {
        const planet = system.planetConfig(planetId);
        if (planet) {
          system.pulseShine(planet);
        }
      }
      for (const planetId of systemPlan.startShineOff) {
        const planet = system.planetConfig(planetId);
        if (planet) {
          system.pulseDim(planet);
        }
      }
    }
  }

  private applySystemPlan(
    system: SolarSystem,
    config: SystemConfig,
    plan: SystemFxPlan,
  ): void {
    const refitTargets = new Map(
      config.planets.map((planet) => [planet.id, planet.orbitRadius]),
    );
    const nextReach = nebulaReach(config.planets);
    if (plan.startOrbitRefit) {
      system.scheduleOrbitRefit(refitTargets, plan.startBurst, nextReach);
    } else if (!system.isWaitingForBurst()) {
      system.snapOrbitTargets(refitTargets, nextReach);
    }

    if (plan.startDayClosed) {
      system.swellDayClosed();
    }
    if (plan.startDayOpen) {
      system.easeDayOpen();
    }

    system.resetOrbitAmounts({
      shineStarting: plan.startShine,
      dimStarting: plan.startShineOff,
    });
  }

  // ── systems ───────────────────────────────────────────────────────────────

  private addSystem(config: SystemConfig): void {
    if (!this.cluster || this.systems.has(config.id)) {
      return;
    }
    const system = new SolarSystem(this.host, {
      id: config.id,
      sun: config.sun,
      planets: config.planets,
      dayClosed: config.dayClosed,
    });
    this.systems.set(config.id, system);
    this.cluster.addChild(system.root);
  }

  private removeSystem(id: string): void {
    const system = this.systems.get(id);
    if (!system) {
      return;
    }
    /**
     * **Its FX are cancelled by key prefix rather than enumerated.** A leaving
     * member may have any number of planets mid-animation, and the plan does
     * not list them — every key this system owns starts with its id after the
     * kind, which is exactly what the scoped keys were for.
     */
    for (const kind of this.fx.kinds()) {
      if (kind.includes(`:${id}:`) || kind.endsWith(`:${id}`)) {
        this.fx.cancel(kind);
      }
    }
    this.cluster?.removeChild(system.root);
    system.destroy();
    this.systems.delete(id);
    // Focus cannot outlive its subject: a camera framing a member who left
    // would sit staring at an empty slot with no way to explain itself.
    if (this.focusedId === id) {
      this.focusSystem(null);
    }
  }

  /**
   * Put every system at its slot and scale it to fit the cluster.
   *
   * **The slot index is the system's position in `snapshot.systems`**, which
   * the host orders by join time. It is deliberately *not* the roster's order,
   * which puts the viewer first — using that would give every member a
   * differently arranged Circle, and two people looking at one phone would
   * disagree about where somebody is.
   */
  /**
   * The sky's gravitational turn, which only exists for a Circle.
   *
   * Two rigid rotations at opposed rates rather than one differential one: the
   * shear between the layers reads as gravity, and costs two transforms a frame
   * instead of two trig calls per star. See `skyBackdrop.ts`.
   */
  private applyBackdropSpin(): void {
    const count = this.systems.size;
    this.starfield?.setSpin(starfieldSpinFor(count));
    this.nebulaSpin = nebulaSpinFor(count);
    this.coreSpin = coreSpinFor(count);

    // **The core is a Circle's backdrop and nothing else's.** One sun in a
    // quiet sky is the personal galaxy, and putting a galactic core behind it
    // would change a picture this whole rework has been careful not to touch.
    this.buildCore();
    this.core?.setVisible(count > 1);
    this.layoutCore();
  }

  /**
   * Build or rebuild the core for the Circle's current blend.
   *
   * **Only when the blend actually changes.** The textures are painted into a
   * canvas, so rebuilding is the most expensive thing here — and members join
   * and leave far more often than a Circle's colour shifts. `galaxyPaletteFor`
   * lands on one of three blends, so most membership changes produce the same
   * id and cost nothing.
   *
   * It has to happen at all because joining and leaving are **incremental**:
   * there is no rebuild to piggyback on, so a Circle that went from warm to
   * cool would otherwise keep its old colour until something else forced a
   * full teardown.
   */
  private buildCore(): void {
    const cluster = this.cluster;
    if (!cluster) {
      return;
    }
    const palette = galaxyPaletteFor(
      this.snapshot.systems.map((system) => system.sun.color),
    );
    if (this.core && this.corePaletteId === palette.id) {
      return;
    }

    if (this.core) {
      cluster.removeChild(this.core.container);
      this.core.container.destroy({ children: true });
    }
    this.core = new GalacticCore(palette, this.nebulaLayoutSeed);
    this.corePaletteId = palette.id;
    cluster.addChildAt(this.core.container, 0);
  }

  private layoutCore(): void {
    if (!this.core) {
      return;
    }
    /**
     * The viewport's diagonal, converted into cluster coordinates so the
     * backdrop covers the frame whatever the fit and zoom happen to be. Without
     * it a small Circle on a small panel left canvas showing around the galaxy.
     */
    const clusterScale = Math.max(
      0.001,
      this.displayBaseFitScale * this.camera.zoom,
    );
    const minSpan = Math.hypot(this.width, this.height) / clusterScale;
    this.core.layout(
      this.measureClusterReach(),
      Math.max(0.3, Math.sin(this.view.tilt)),
      minSpan,
    );
  }

  /**
   * How far apart neighbouring slots sit.
   *
   * **Derived from the collision that matters**: the furthest planet of one
   * system plus a clear halo around the neighbouring sun it would otherwise
   * reach. Both terms use the largest values in the Circle, so an uneven
   * Circle is spaced by its biggest member rather than its average.
   */
  private systemSpacing(count: number, scale: number): number {
    if (count <= 1) {
      return 0;
    }
    let widestReach = 0;
    let widestSun = 0;
    for (const system of this.systems.values()) {
      widestReach = Math.max(widestReach, system.getTargetReach());
      widestSun = Math.max(widestSun, system.getSunDisplayRadius());
    }
    return (widestReach + widestSun * SUN_CLEARANCE) * scale;
  }

  private placeSystems(): void {
    const count = this.systems.size;
    const scale = clusterSystemScale(count);

    const spacing = this.systemSpacing(count, scale);

    let index = 0;
    for (const config of this.snapshot.systems) {
      const system = this.systems.get(config.id);
      if (!system) {
        continue;
      }
      const slot = clusterSlot(index, spacing);
      // The convergence pulls every system toward the middle by the same
      // fraction, so the arrangement is preserved — the Circle gathers rather
      // than rearranging, which keeps a member findable throughout.
      const pull = 1 - this.convergence;
      system.root.position.set(slot.x * pull, slot.y * pull);
      system.root.scale.set(scale);
      index += 1;
    }
  }

  // ── the Circle finished ───────────────────────────────────────────────────

  /**
   * Every member closed their day.
   *
   * **Bridges and a gathering, which is what was asked for**: light reaches
   * from the middle to each sun while the cluster draws slightly in, holds, and
   * releases. Both are drawn from the same `t`, so they are one gesture rather
   * than two effects that happen to overlap.
   *
   * **Nothing happens for a Circle of one.** A lone member closing their day is
   * already the sun's own swell; bridges to nobody would be a line from a point
   * to itself, and a gathering of one is a system sliding for no reason.
   */
  private playSkyClosed(): void {
    const bridges = this.bridges;
    if (!bridges || this.systems.size < 2) {
      return;
    }

    // Captured once: the anchors are where the systems sit *before* the
    // convergence moves them, so the light does not chase its own target.
    const anchors = [...this.systems.values()].map((system) => ({
      x: system.root.x,
      y: system.root.y,
      color: system.getSunColor(),
    }));

    /**
     * The angle every member's planets are drawn toward.
     *
     * **Fixed for the whole moment, and the same for every system**, which is
     * what makes it read as the Circle synchronising rather than as each
     * system tidying itself independently. Taken from the elapsed clock so it
     * is not always the same direction on screen.
     */
    const conjunction = (this.elapsedMs / 900) % (Math.PI * 2);

    this.playFx(
      FX_DAY_CLOSED_MS * 2,
      (t) => {
        if (bridges.destroyed) {
          return;
        }
        paintSkyBridges(bridges, anchors, t);
        this.convergence = convergenceAt(t);
        // Same envelope as the gathering, so the light, the drawing-in and the
        // falling-into-step are one gesture with one shape.
        const align = convergenceAt(t) / CONVERGENCE_MAX;
        for (const system of this.systems.values()) {
          system.setPhaseAlignment(align * 0.22, conjunction);
        }
        this.placeSystems();
      },
      () => {
        if (!bridges.destroyed) {
          clearSkyBridges(bridges);
        }
        this.convergence = 0;
        for (const system of this.systems.values()) {
          system.setPhaseAlignment(0, 0);
        }
        this.placeSystems();
      },
      SKY_CLOSED_KIND,
    );
  }

  /**
   * Play the Circle-complete moment again on demand.
   *
   * **Because it is worth watching twice.** The moment fires once when the last
   * member checks in, and everybody else has already closed their day by then —
   * so for most of the Circle it happens while they are not looking. This is
   * how a host offers it back.
   */
  replaySkyClosed(): void {
    if (!this.snapshot.skyClosed) {
      return;
    }
    this.fx.cancel(SKY_CLOSED_KIND);
    this.playSkyClosed();
  }

  private clearSkyClosed(): void {
    this.fx.cancel(SKY_CLOSED_KIND);
    if (this.bridges && !this.bridges.destroyed) {
      clearSkyBridges(this.bridges);
    }
    this.convergence = 0;
    for (const system of this.systems.values()) {
      system.setPhaseAlignment(0, 0);
    }
    this.placeSystems();
  }

  // ── camera and fit ────────────────────────────────────────────────────────

  private applyCamera(): void {
    if (!this.cluster) {
      return;
    }
    this.cluster.scale.set(this.displayBaseFitScale * this.camera.zoom);
    this.cluster.position.set(
      this.width / 2 + this.camera.panX,
      this.height / 2 + this.camera.panY,
    );
  }

  private shouldAutoFitCamera(): boolean {
    if (this.cameraInteracting) {
      return false;
    }
    return (
      Math.abs(this.camera.panX) < CAMERA_AUTOFIT_PAN_THRESHOLD &&
      Math.abs(this.camera.panY) < CAMERA_AUTOFIT_PAN_THRESHOLD &&
      Math.abs(this.camera.zoom - 1) < CAMERA_AUTOFIT_ZOOM_EPSILON
    );
  }

  private fitScaleForReach(reach: number): number {
    const span = Math.min(this.width, this.height);
    return Math.min(1, (span * 0.44) / Math.max(reach, 1));
  }

  /**
   * How far the whole cluster extends — the furthest edge of any system, not
   * the sum and not the largest one's reach. Either would frame the wrong
   * thing, and the second would let a member with ten goals push everybody
   * else off screen.
   */
  private measureClusterReach(): number {
    const count = this.systems.size;
    const scale = clusterSystemScale(count);
    const spacing = this.systemSpacing(count, scale);

    const entries: { slotDistance: number; reach: number }[] = [];
    let index = 0;
    for (const config of this.snapshot.systems) {
      const system = this.systems.get(config.id);
      if (!system) {
        continue;
      }
      entries.push({
        slotDistance: clusterSlot(index, spacing).distance,
        reach: system.getDisplayReach(),
      });
      index += 1;
    }
    return clusterReach(entries, scale);
  }

  private settleReach(animating: boolean): void {
    this.clusterReachValue = this.measureClusterReach();
    this.baseFitScale = this.fitScaleForReach(this.clusterReachValue);
    if (animating && !this.reducedMotion) {
      return;
    }
    this.displayBaseFitScale = this.baseFitScale;
    this.applyCamera();
    this.applyNebulaReachScale();
    this.layoutCore();
  }

  /** A system's reach changed and is not animating. Refit now. */
  private reachSettled(): void {
    this.settleReach(false);
  }

  /**
   * A refit is starting. Capture the fit this animation interpolates from, and
   * hand back the stepper the system calls each frame.
   */
  private beginReachAnimation(): (t: number) => void {
    this.fx.cancel(CAMERA_FIT_KIND);
    const fitStart = this.displayBaseFitScale;
    const autoFit = this.shouldAutoFitCamera();
    return (t: number) => {
      // Re-measured each frame: with several systems, one of them animating
      // changes the cluster's extent as it goes.
      const fitTo = this.fitScaleForReach(this.measureClusterReach());
      if (autoFit) {
        this.displayBaseFitScale = fitStart + (fitTo - fitStart) * t;
      }
      this.applyCamera();
      this.applyNebulaReachScale();
    };
  }

  private endReachAnimation(): void {
    this.clusterReachValue = this.measureClusterReach();
    const fitTo = this.fitScaleForReach(this.clusterReachValue);
    this.baseFitScale = fitTo;
    if (this.shouldAutoFitCamera()) {
      this.displayBaseFitScale = fitTo;
    }
    this.applyCamera();
    this.applyNebulaReachScale();
  }

  getCamera(): GalaxyCamera {
    return { ...this.camera };
  }

  panBy(dx: number, dy: number): void {
    this.fx.cancel(CAMERA_FIT_KIND);
    this.camera.panX += dx;
    this.camera.panY += dy;
    this.applyCamera();
  }

  zoomBy(factor: number): void {
    this.fx.cancel(CAMERA_FIT_KIND);
    this.camera.zoom = Math.min(
      MAX_CAMERA_ZOOM,
      Math.max(MIN_CAMERA_ZOOM, this.camera.zoom * factor),
    );
    this.applyCamera();
  }

  /**
   * Back to the framing the sky opened with.
   *
   * **It clears the focused system too, and that is not tidiness.** Focus is a
   * camera state that the *caller* also reads: `mountGalaxy` toggles on
   * `getFocusedSystem() === systemId`, so a reset that moved the camera home
   * while still reporting a focused member left the next tap on that member's
   * sun asking to pull *back out* — from a view that was already out. The
   * member you tapped would do nothing, and only that member.
   */
  resetCamera(): void {
    this.fx.cancel(CAMERA_FIT_KIND);
    this.focusedId = null;
    this.camera = { panX: 0, panY: 0, zoom: 1 };
    this.applyCamera();
  }

  setCameraInteracting(active: boolean): void {
    this.cameraInteracting = active;
    if (active) {
      this.fx.cancel(CAMERA_FIT_KIND);
    }
  }

  // ── focus ─────────────────────────────────────────────────────────────────

  /**
   * Fly the camera to one member's system, or back out to the whole Circle.
   *
   * ## Why this exists, having been turned down once
   *
   * The earlier answer was free pan and zoom with no focus mode, and that was
   * the wrong call for a reason nobody had measured yet: **ten systems in one
   * viewport means each is about a seventh of a solo galaxy**, so a 12px planet
   * draws at two pixels. There is nothing legible to pan *around*. No spacing
   * number fixes that — it is what ten of anything in one frame costs.
   *
   * So the cluster is the overview and this is how you read a person.
   *
   * ## It moves the camera, never the layout
   *
   * A system stays exactly where the layout put it. Everyone sees the same sky
   * and a screenshot means the same thing whoever took it; only the viewer's
   * vantage point differs. That is the same reasoning that keeps the viewer's
   * own sun from being centred.
   */
  focusSystem(systemId: string | null): void {
    const target = systemId === null ? null : this.systems.get(systemId);
    if (systemId !== null && !target) {
      return;
    }
    this.focusedId = target ? systemId : null;

    const to = target
      ? this.cameraForSystem(target)
      : { panX: 0, panY: 0, zoom: 1 };
    const from = { ...this.camera };

    this.fx.cancel(CAMERA_FIT_KIND);
    this.playFx(
      CAMERA_FIT_MS,
      (t) => {
        this.camera = {
          panX: from.panX + (to.panX - from.panX) * t,
          panY: from.panY + (to.panY - from.panY) * t,
          zoom: from.zoom + (to.zoom - from.zoom) * t,
        };
        this.applyCamera();
      },
      () => {
        this.camera = { ...to };
        this.applyCamera();
      },
      CAMERA_FIT_KIND,
    );
  }

  getFocusedSystem(): string | null {
    return this.focusedId;
  }

  /**
   * The camera that frames one system.
   *
   * Zoom is chosen so the system's own reach fills the same fraction of the
   * viewport a solo galaxy does, then clamped — **so focusing a member of a
   * ten-person Circle lands on roughly the picture they would see alone**,
   * which is the whole point of going there.
   */
  private cameraForSystem(system: SolarSystem): GalaxyCamera {
    const slot = this.slotFor(system.id);
    const systemScale = clusterSystemScale(this.systems.size);
    const drawnReach = Math.max(1, system.getTargetReach() * systemScale);
    const span = Math.min(this.width, this.height);

    const wanted = (span * 0.44) / (drawnReach * this.displayBaseFitScale);
    const zoom = Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, wanted));

    // The slot is in cluster space, so it scales with the fit and the zoom
    // before it becomes a pan in screen pixels.
    const scale = this.displayBaseFitScale * zoom;
    return {
      panX: -slot.x * scale,
      panY: -slot.y * scale,
      zoom,
    };
  }

  private slotFor(systemId: string): { x: number; y: number } {
    const count = this.systems.size;
    const spacing = this.systemSpacing(count, clusterSystemScale(count));

    let index = 0;
    for (const config of this.snapshot.systems) {
      if (!this.systems.has(config.id)) {
        continue;
      }
      if (config.id === systemId) {
        return clusterSlot(index, spacing);
      }
      index += 1;
    }
    return { x: 0, y: 0 };
  }

  // ── view ──────────────────────────────────────────────────────────────────

  setView(next: Partial<ViewRotation>): void {
    if (next.yaw !== undefined) {
      this.view.yaw = next.yaw;
    }
    if (next.tilt !== undefined) {
      this.view.tilt = clampTilt(next.tilt);
    }
    if (next.roll !== undefined) {
      this.view.roll = next.roll;
    }
    this.applyView();
  }

  getView(): ViewRotation {
    return { ...this.view };
  }

  private applyView(): void {
    for (const system of this.systems.values()) {
      system.applyView();
    }
  }

  /**
   * The viewport changed size.
   *
   * ## Two separate bugs lived here, and the second was the real one
   *
   * **Resizing used to re-derive the compact/full-size mode**, and the mode
   * carries a *projection*: full size is `tilt 0.95`, compact is `tilt 0.5`, and
   * `flattenFromTilt` is `sin(tilt)` — so every orbit ellipse jumped from 0.81
   * of its width to 0.48 the instant a pane crossed 420px. On a desktop split
   * pane that threshold sits right where the handle lives, so dragging it
   * squashed the galaxy flat and back. **That is what "resizing distorts the
   * view" was**, and the first fix — leaving the fit alone — missed it entirely,
   * because it was never about scale.
   *
   * So `compact` is now decided **once, at mount**. It is a fact about which
   * surface this is — an embedded panel or a full-bleed view — and not about
   * how many pixels are free this frame. Nothing about the projection, the star
   * scale or the ring weight changes while a pane is being dragged.
   *
   * ## And resizing still shows more sky rather than zooming
   *
   * The fit follows **content** — a reach changing, a member joining. A bigger
   * viewport reveals more; it does not scale what is already there.
   *
   * **It does shrink when it has to.** If the viewport gets small enough that
   * the cluster no longer fits, the fit tightens so nothing is silently cropped.
   * It never grows back on its own: `resetCamera` is the way to reframe, and it
   * is a deliberate act rather than something that happens under the cursor.
   */
  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.root.hitArea = new Rectangle(0, 0, width, height);

    this.starfield?.layout(width, height);
    this.skyAmbience?.layout(width, height);
    this.placeSystems();

    /**
     * **The fit is recomputed for the new viewport, in both directions.**
     *
     * This used to be `if (needed < this.baseFitScale)` — a one-way ratchet, so
     * the galaxy could only ever get smaller. Drag a window narrower and it
     * shrank; drag it back and it stayed shrunk, because the larger fit was
     * discarded. Over a continuous drag that reads as the picture warping while
     * the frame grows around it, which is what "resizing distorts the galaxy"
     * was. **The window was only ever supposed to change the viewhole.**
     *
     * Two earlier attempts looked elsewhere — the orbit refit, and the compact
     * tilt flip at 420px — and both found real bugs that were not this one. The
     * scale here is uniform (`fitScaleForReach` uses `min(width, height)`), so
     * "no non-uniform scale exists in the scene" was true and pointed away from
     * the answer.
     *
     * `shouldAutoFitCamera` is what the other two assignment sites use to decide
     * whether the *displayed* fit follows, and `layout` consulted neither. So
     * somebody who had panned or zoomed had their view yanked back by a resize.
     * Now the base moves always and the display moves only when the camera is
     * still where the scene put it.
     */
    this.baseFitScale = this.fitScaleForReach(this.measureClusterReach());
    if (this.shouldAutoFitCamera()) {
      this.displayBaseFitScale = this.baseFitScale;
    }

    this.applyCamera();
    this.applyNebulaReachScale();
    this.replaceNebula();
  }

  // ── host controls ─────────────────────────────────────────────────────────

  setBeltVisible(planetId: string, visible: boolean): void {
    // Planet ids are unique per system, so this asks each in turn rather than
    // assuming the caller knows which member owns the planet.
    for (const system of this.systems.values()) {
      if (system.planetConfig(planetId)) {
        system.setBeltVisible(planetId, visible);
        return;
      }
    }
  }

  /**
   * **A personal-galaxy control**: the sun that grows is the viewer's own, and
   * a Circle has no single "the sun". Applies to the first system, which in a
   * one-person sky is the only one.
   */
  setSunGrowth(growth: number): void {
    const clamped = Math.min(1, Math.max(0, growth));
    const first = this.snapshot.systems[0];
    if (!first) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      systems: [
        { ...first, sun: { ...first.sun, growth: clamped } },
        ...this.snapshot.systems.slice(1),
      ],
    };
    this.systems.get(first.id)?.setSunGrowth(clamped);
  }

  // ── the achieve burst, which is a sky effect ──────────────────────────────

  /**
   * The stars this burst carries, set immediately before `removePlanet`.
   *
   * The system decides *when* a burst starts (it owns the FX and the body);
   * the sky decides *what* it throws (it owns the starfield). Passing them
   * down through `removePlanet` would put a sky concept in a system's
   * signature for no gain.
   */
  private burstStars: StarConfig[] = [];

  private beginPlanetBurst(
    planetId: string,
    origin: { x: number; y: number },
    removed?: PlanetConfig,
  ): (t: number) => void {
    const stars = this.burstStars;
    const particles = this.starfield?.addStars(stars, origin) ?? [];
    this.skyAmbience?.spawnAchieveBurst(
      origin.x,
      origin.y,
      this.milestoneTier(),
    );
    playAchieveCelebration(
      this.root,
      origin.x,
      origin.y,
      removed?.color ?? 0xffffff,
      (update, finish, kind) => {
        this.playFx(FX_BURST_MS, update, finish, kind);
      },
      `achieve-ring:${planetId}`,
      this.skyAmbience?.getAchieveBurstParams().ringStrength ?? 1,
    );
    return (t: number) => {
      this.lerpParticles(particles, stars, origin, t);
    };
  }

  private lerpParticles(
    particles: Particle[],
    stars: StarConfig[],
    origin: { x: number; y: number },
    t: number,
  ): void {
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const star = stars[i];
      if (!particle || !star) {
        continue;
      }
      particle.x = origin.x + (star.x * this.width - origin.x) * t;
      particle.y = origin.y + (star.y * this.height - origin.y) * t;
    }
  }

  // ── per-frame ─────────────────────────────────────────────────────────────

  tick(deltaMS: number): void {
    this.elapsedMs += deltaMS;
    this.tickFx(deltaMS);
    /**
     * **A frozen sky is still, and that is the whole of the answer.**
     *
     * An archived Circle's roster is captured at the instant it was archived,
     * so nothing in it can change again. Orbits that kept turning would be
     * motion standing for liveness that is not there — the same objection that
     * switched the backdrop off, applied to the half that was left running.
     *
     * `tickFx` above is deliberately outside this: focus, the camera fly-to and
     * the refit are things the *viewer* is doing now, and they should work on a
     * frozen Circle exactly as they do on a live one.
     */
    const motion = !this.reducedMotion && !this.frozen;
    this.starfield?.tick(
      this.elapsedMs,
      motion,
      milestoneTwinkleBoost(this.milestoneTier()),
    );
    this.skyAmbience?.tick(deltaMS, motion && this.ambientEffects);
    const nebula = this.cluster?.getChildByLabel("nebula");
    if (nebula instanceof Container) {
      tickNebula(nebula, this.elapsedMs, deltaMS, motion);
      if (motion && this.nebulaSpin !== 0) {
        nebula.rotation = (this.elapsedMs / 1000) * this.nebulaSpin;
      }
    }
    if (motion) {
      this.core?.tick(this.elapsedMs, this.coreSpin);
    }
    for (const system of this.systems.values()) {
      system.tick(deltaMS, motion, this.elapsedMs);
    }
  }

  destroy(): void {
    this.fx.clear();
    this.clearScene();
    this.root.destroy({ children: true });
    this.starTexture.destroy(true);
    this.shadeTexture.destroy(true);
    this.sunGlowTexture.destroy(true);
    this.sunRayTexture.destroy(true);
  }

  private rebuild(): void {
    this.clearScene();
    this.skyAmbience = new SkyAmbience(this.nebulaLayoutSeed ^ 0xfa11);
    this.skyAmbience.setTier(this.milestoneTier());
    this.skyAmbience.setEnabled(this.ambientEffects);
    this.skyAmbience.layout(this.width, this.height);
    this.skyAmbience.container.eventMode = "none";
    this.root.addChild(this.skyAmbience.container);

    this.starfield = new Starfield({
      texture: this.starTexture,
      stars: this.snapshot.stars.slice(0, this.starCap),
      width: this.width,
      height: this.height,
      starScale: this.starScale,
    });
    this.starfield.container.eventMode = "none";
    this.root.addChild(this.starfield.container);

    this.cluster = new Container({ label: "cluster", sortableChildren: true });
    this.cluster.eventMode = "passive";
    this.root.addChild(this.cluster);

    /**
     * **The Circle's colour comes from its members' suns, all of them.**
     *
     * Not the first member's — that was the placeholder, and it made a Circle's
     * whole backdrop depend on who happened to join first. `galaxyPaletteFor`
     * weighs every sun and lands on one of three blends; the arrangement of
     * those three on a single axis is what makes the forbidden pairings
     * — yellow with blue, yellow with purple — impossible rather than merely
     * checked for.
     */
    this.buildCore();

    this.bridges = createSkyBridges();
    this.cluster.addChild(this.bridges);

    for (const config of this.snapshot.systems) {
      this.addSystem(config);
    }

    this.replaceNebula();
    this.placeSystems();
    this.applyBackdropSpin();
    this.settleReach(false);
  }

  // ── nebula, background for the whole sky ──────────────────────────────────

  private applyNebulaReachScale(): void {
    const nebula = this.cluster?.getChildByLabel("nebula");
    if (!(nebula instanceof Container) || this.clusterReachValue <= 0) {
      return;
    }
    nebula.scale.set(this.measureClusterReach() / this.clusterReachValue);
  }

  private replaceNebula(): void {
    const cluster = this.cluster;
    if (!cluster) {
      return;
    }
    const planets = this.snapshot.systems.flatMap((system) => system.planets);
    const reach = nebulaReach(planets);
    const signature = nebulaSignature({
      stars: this.snapshot.stars,
      preview: this.nebulaPreviewActive(),
      reach,
      nebula: this.snapshot.nebula,
      milestoneTier: this.milestoneTier(),
    });
    if (this.nebulaSignature === signature) {
      return;
    }
    const existing = cluster.getChildByLabel("nebula");
    const hadNebula = Boolean(existing);
    this.fx.cancel(NEBULA_BIRTH_KIND);
    if (existing) {
      cluster.removeChild(existing);
      existing.destroy();
    }
    const nebula = createNebula({
      nebula: this.snapshot.nebula,
      stars: this.snapshot.stars,
      reach,
      texture: this.starTexture,
      preview: this.nebulaPreviewActive(),
      milestoneTier: this.milestoneTier(),
      layoutSeed: this.nebulaLayoutSeed,
    });
    this.nebulaSignature = signature;
    if (!nebula) {
      return;
    }
    nebula.eventMode = "none";
    nebula.zIndex = -2000;
    cluster.addChild(nebula);
    this.applyNebulaReachScale();
    if (hadNebula || this.reducedMotion) {
      nebula.alpha = 1;
      return;
    }
    nebula.alpha = 0;
    this.playFx(
      FX_NEBULA_MS,
      (t) => {
        if (!nebula.destroyed) {
          nebula.alpha = t;
        }
      },
      () => {
        if (!nebula.destroyed) {
          nebula.alpha = 1;
        }
      },
      NEBULA_BIRTH_KIND,
    );
  }

  // ── fx plumbing ───────────────────────────────────────────────────────────

  private playFx(
    duration: number,
    update: (t: number) => void,
    finish: () => void,
    kind: string,
  ): void {
    this.fx.cancel(kind);
    if (this.reducedMotion) {
      update(1);
      finish();
      return;
    }
    this.fx.play({ kind, duration, update, finish });
  }

  private tickFx(deltaMS: number): void {
    this.fx.tick(deltaMS, easeOut);
    for (const system of this.systems.values()) {
      system.maybeStartPendingOrbitRefit();
    }
  }

  private clearScene(): void {
    this.fx.clear();
    this.nebulaSignature = null;
    this.starfield = null;
    this.skyAmbience = null;
    for (const system of this.systems.values()) {
      system.destroy();
    }
    this.systems.clear();
    this.bridges = null;
    this.core = null;
    this.corePaletteId = null;
    this.cluster = null;
    for (const child of [...this.root.children]) {
      child.destroy({ children: true });
    }
    this.root.removeChildren();
  }
}
