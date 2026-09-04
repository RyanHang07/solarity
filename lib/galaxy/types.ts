import type { CategorySlug } from "./categories";

export type ColorHex = number;

export type ViewRotation = {
  yaw: number;
  tilt: number;
  roll: number;
};

export type SunConfig = {
  color: ColorHex;
  radius: number;
  growth?: number;
};

/** Decorative Saturn belt around a planet. Not the Solarity Ring (orbit ellipse). */
export type BeltConfig = {
  color: ColorHex;
  innerRadius: number;
  outerRadius: number;
};

export type SurfaceKind =
  | "terra"
  | "gas"
  | "arid"
  | "ice"
  | "lava"
  | "storm";

export type BeltMode = "auto" | "on" | "off";

/** Host-side per-goal appearance — mapped onto PlanetConfig at snapshot build. */
export type GoalCosmetics = {
  planetRadius?: number;
  surfaceKind?: SurfaceKind;
  beltMode?: BeltMode;
  /** Persisted once at goal create when beltMode is auto. */
  beltVisible?: boolean;
  visualSeed?: number;
};

/** Galaxy-wide cosmetics prefs from the host DB. */
export type GalaxyCosmetics = {
  sunPresetId?: string;
  nebulaCategorySlug?: CategorySlug;
  nebulaPreview?: boolean;
  defaults?: Partial<GoalCosmetics>;
};

export type PlanetConfig = {
  id: string;
  color: ColorHex;
  radius: number;
  orbitRadius: number;
  orbitSpeed: number;
  phase: number;
  shine: boolean;
  belt?: BeltConfig;
  beltVisible?: boolean;
  surfaceKind?: SurfaceKind;
  visualSeed?: number;
};

export type StarConfig = {
  x: number;
  y: number;
  size: number;
  twinkle: number;
  seed: number;
  color: ColorHex;
};

export type NebulaConfig = {
  colors: ColorHex[];
  /** Parallel to colors — goals achieved per goal-color family. */
  weights?: number[];
  alpha: number;
};

/**
 * One person's solar system: a sun and the planets around it.
 *
 * **The unit that repeats.** A personal galaxy has exactly one; Solarity's
 * Circle galaxy has one per member, up to ten, in a single sky.
 */
export type SystemConfig = {
  /**
   * Stable across renders. The member's id in a Circle; `"self"` in a personal
   * galaxy, which is what `singleSystemSnapshot` uses.
   */
  id: string;
  sun: SunConfig;
  planets: PlanetConfig[];
  /**
   * This person finished everything active today. Host sets it from
   * `daily_completion`, including hidden goals.
   */
  dayClosed?: boolean;
  /**
   * For the host's accessible label. **Never drawn** — there is no text in the
   * scene, and putting a username in the canvas would put it somewhere no
   * screen reader can reach.
   */
  label?: string;
};

/**
 * Everything on the canvas.
 *
 * ## Two tiers, and only one of them repeats
 *
 * `systems` is per person. Everything beside it belongs to the **sky** and is
 * shared by every system in the canvas — which is not a stylistic split but a
 * structural one: `placeAchievementStars` returns `x`/`y` in `0..1` of the
 * whole canvas, so a star has never been positioned relative to a sun and
 * cannot be without redefining what a star is.
 *
 * ## `sun` and `planets` used to be here
 *
 * They moved into `SystemConfig`. Callers that render one person use
 * `singleSystemSnapshot`, which is a real adapter rather than a compatibility
 * shim: **the personal galaxy is the one-element case and takes the same code
 * path as a Circle of ten.** Keeping both shapes on this type would have meant
 * every consumer — the diff most of all — handling two, and the diff is where
 * correctness lives.
 */
export type GalaxySnapshot = {
  systems: SystemConfig[];

  /**
   * Achievement stars, in canvas coordinates.
   *
   * **Personal galaxy only.** Ten members' stars in one sky would scatter with
   * nothing tying any of them to the person who earned it, so a Circle sky has
   * none.
   */
  stars: StarConfig[];
  nebula?: NebulaConfig;
  /** Host: show seeded nebula before five achievement families unlock it. */
  nebulaPreview?: boolean;

  /**
   * Lifetime achievements. **Personal galaxy only**, and the reason
   * `ambienceTier` exists: summed across a Circle of ten this reaches the top
   * tier within a week and then never moves again, so it cannot drive a shared
   * sky.
   */
  achievementCount?: number;

  /**
   * Ambience tier, when the host wants to set it rather than have it derived
   * from `achievementCount`. A Circle passes its own — from the group's cycle
   * stats, which is the one number that is actually about the group.
   */
  ambienceTier?: number;

  /**
   * Every system finished. Distinct from a system's own `dayClosed`, and in
   * Solarity it comes from `group_daily_completion` rather than being derived
   * here — that column already accounts for a member who joined mid-cycle, and
   * a renderer that recomputed it would disagree with the streak.
   */
  skyClosed?: boolean;
};

/**
 * The pre-`systems` shape, for hosts that render one person.
 *
 * Not deprecated and not going away: it is the natural thing for a caller with
 * one sun to hand over, and `singleSystemSnapshot` is the only place that
 * knows about it.
 */
export type SingleSystemSnapshot = {
  sun: SunConfig;
  planets: PlanetConfig[];
  stars: StarConfig[];
  nebula?: NebulaConfig;
  achievementCount?: number;
  nebulaPreview?: boolean;
  dayClosed?: boolean;
};

export type GalaxyCamera = {
  panX: number;
  panY: number;
  zoom: number;
};

export type MountOptions = {
  background?: ColorHex;
  starCap?: number;
  reducedMotion?: boolean;
  view?: Partial<ViewRotation>;
  compact?: boolean;
  starScale?: number;
  /** Solarity: tapping a planet (not its orbit Ring or belt) opens the goal. */
  onPlanetSelect?: (planetId: string) => void;
  /**
   * Tapping a member's sun in a Circle. The host decides what it means —
   * `handle.focusSystem(id)` is the usual answer.
   */
  onSystemSelect?: (systemId: string) => void;
  /**
   * The pointer entered a member's sun or one of their planets, or left it.
   *
   * **The scene draws no text and is not going to.** This reports the member
   * and the pointer's position in canvas pixels so the host can render a name
   * in the DOM — styled by the app, selectable, and reachable by a screen
   * reader, none of which a label baked into WebGL would be.
   *
   * `null` means the pointer left. Hover is a mouse idea, so a touch device
   * will see this fire around a tap and should not be given anything that
   * matters.
   */
  onSystemHover?: (systemId: string | null, x: number, y: number) => void;
  /**
   * The data behind this sky stopped changing at some past instant — an
   * archived or locked Circle, whose roster is frozen at the moment it stopped.
   *
   * Orbits stop, the backdrop stops, the starfield stops. **The camera does
   * not**: panning, zooming and focusing are things the viewer is doing now.
   *
   * Distinct from `reducedMotion`, which is read from the platform and is a
   * preference rather than a fact about the data.
   */
  frozen?: boolean;
  /** Playground-only. Product nebula still requires 5+ category colours. */
  previewNebula?: boolean;
  /** Overlay zoom/pan/rotate controls (recommended on compact hosts). */
  cameraControls?: boolean;
  /** Ambient sky motion such as falling stars. */
  ambientEffects?: boolean;
  /**
   * The GPU took the context back — on iOS, usually after the app was
   * backgrounded. The scene is intact and nothing is being drawn, so the
   * honest response is for the host to remount. Rendering is already stopped
   * before this fires.
   */
  onContextLost?: () => void;
  /** The browser handed a context back. Rendering has already resumed. */
  onContextRestored?: () => void;
};

export type GalaxyHandle = {
  canvas: HTMLCanvasElement;
  setSnapshot: (next: GalaxySnapshot) => void;
  setView: (view: Partial<ViewRotation>) => void;
  getView: () => ViewRotation;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (factor: number) => void;
  resetCamera: () => void;
  /**
   * Fly the camera to one member, or `null` to pull back to the whole Circle.
   *
   * **Ten systems in one viewport means each is about a seventh of a solo
   * galaxy**, so a 12px planet draws at two pixels. The cluster is the
   * overview; this is how a person is actually read.
   */
  focusSystem: (systemId: string | null) => void;
  /**
   * Play the Circle-complete moment again.
   *
   * It fires once when the last member checks in — by which point everyone
   * else closed their day earlier and was not looking. Does nothing unless the
   * Circle is actually complete.
   */
  replayCircleComplete: () => void;
  getFocusedSystem: () => string | null;
  getCamera: () => GalaxyCamera;
  setBeltVisible: (planetId: string, visible: boolean) => void;
  setPreviewNebula: (enabled: boolean) => void;
  setAmbientEffects: (enabled: boolean) => void;
  setSunGrowth: (growth: number) => void;
  /**
   * Should a one-finger vertical drag scroll the page behind the canvas?
   *
   * **On for an embedded card, off when the canvas is the whole screen**, and
   * the two cannot be one answer decided at mount because the same mount is
   * both: the card expands to full screen without remounting.
   *
   * It is really a question about *pinch*. `touch-action: pan-y` hands the
   * gesture stream to the browser, and iOS then treats two fingers as a page
   * zoom — the canvas never sees the pointers, so the scene's own pinch is
   * dead and the whole page scales instead. That trade is worth it in a card
   * inside a scrolling column and worth nothing full screen, where there is
   * nothing behind the canvas to scroll.
   */
  setPageScrollThrough: (enabled: boolean) => void;
  /**
   * Re-measure the host **now**, synchronously.
   *
   * The `ResizeObserver` inside the mount coalesces to the next frame, which is
   * right for a drag and wrong for a host that changes size as part of a
   * transition: a view transition snapshots the new DOM in the same task, so a
   * resize deferred to the next frame is a resize that happens *after* the
   * picture the browser is about to animate towards has already been taken —
   * and the canvas appears at its old size, overflowing its new frame.
   *
   * Call this inside the same synchronous block that changes the host's size.
   * Calling it at any other time is harmless and does nothing the observer
   * would not have done.
   */
  resize: () => void;

  destroy: () => void;
};
