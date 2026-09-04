import type { SurfaceKind } from "./types";

/**
 * The six planet surfaces, in roll order.
 *
 * **Here rather than beside the code that paints them**, because this module
 * imports nothing and `render/planetTexture.ts` imports `pixi.js`. The list is
 * needed by `planetCosmetics.ts`, which `buildSnapshot.ts` needs, which a host
 * runs on the server — so keeping it next to the painter quietly made the data
 * half of this package depend on WebGL. `planetTexture.ts` re-exports it.
 */
export const SURFACE_KINDS: readonly SurfaceKind[] = [
  "terra",
  "gas",
  "arid",
  "ice",
  "lava",
  "storm",
];

export const DEFAULT_STAR_CAP = 2000;
export const DEFAULT_BACKGROUND = 0x07070e;
export const DEFAULT_YAW = 0.55;
export const DEFAULT_TILT = 0.95;
export const DEFAULT_COMPACT_YAW = 0.78;
export const DEFAULT_COMPACT_TILT = 0.5;
export const DEFAULT_ROLL = 0;
export const MIN_TILT = 0.18;
export const MAX_TILT = 1.45;
export const COMPACT_MAX_WIDTH = 420;
export const COMPACT_MAX_HEIGHT = 320;
export const COMPACT_STAR_SCALE = 0.62;
export const COMPACT_ORBIT_LEGIBILITY = 1.45;

export const isCompactLayout = (width: number, height: number): boolean =>
  width <= COMPACT_MAX_WIDTH || height <= COMPACT_MAX_HEIGHT;
export const SUN_GROWTH_EASE_MS = 5000;
export const SUN_DISPLAY_SCALE = 1.5;
/** Stable layout seed — Sun size must not shift when only tint changes. */
export const SUN_VISUAL_SEED = 0x7f4a21c3;
export const NEBULA_MIN_CATEGORIES = 5;
export const ACHIEVEMENT_MILESTONE_STEP = 5;
export const STARS_PER_ACHIEVEMENT_MIN = 1;
export const STARS_PER_ACHIEVEMENT_MAX = 3;
export const NEBULA_STAMP_COUNT = 16;
export const MIN_CAMERA_ZOOM = 0.65;
export const MAX_CAMERA_ZOOM = 2.4;
export const FX_APPEAR_MS = 420;
export const FX_SHINE_MS = 1100;
export const FX_BURST_MS = 720;
export const FX_DAY_CLOSED_MS = 980;
export const FX_NEBULA_MS = 640;
export const NEBULA_STAMPS_PER_LOBE = 5;
export const ORBIT_SPIN_UP_MS = 2500;
export const ORBIT_REFIT_MS = 900;
export const CAMERA_FIT_MS = 700;
export const CAMERA_AUTOFIT_PAN_THRESHOLD = 24;
export const CAMERA_AUTOFIT_ZOOM_EPSILON = 0.08;
