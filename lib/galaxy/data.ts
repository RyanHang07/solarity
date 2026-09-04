/**
 * The galaxy's data half. **Safe to import from a Server Component.**
 *
 * ## Why this file exists
 *
 * `index.ts` re-exports `mountGalaxy`, and `mountGalaxy` imports `pixi.js`. A
 * server component that only wanted `categoryBySlug` would therefore pull the
 * whole renderer into the graph, and the `dynamic(ssr: false)` arrangement that
 * is supposed to keep WebGL out of the initial payload would quietly stop
 * working.
 *
 * **Nothing reachable from this file imports `pixi.js`.** That is asserted by
 * `data.boundary.test.ts`, which walks the import graph, because it is the kind
 * of rule that is broken by adding one convenient re-export and is invisible to
 * `tsc` and to ESLint. This codebase has met the shape before — `patterns.md`,
 * "a boundary only the bundler enforces".
 *
 * `SURFACE_KINDS` is the reason the rule needed stating: it is six strings that
 * used to live in `render/planetTexture.ts`, so importing the list imported the
 * texture generator, and importing the texture generator imported PixiJS. It
 * lives in `constants.ts` now.
 */

// ─── Building a snapshot ───
export { buildGalaxySnapshot } from "./buildSnapshot";
export type {
  BuildGalaxySnapshotInput,
  SnapshotAchievement,
  SnapshotGoal,
} from "./buildSnapshot";
export {
  singleSystemSnapshot,
  onlySystem,
  SELF_SYSTEM_ID,
} from "./singleSystem";

// ─── Circles: a member's sun, and the sky's colour ───
export { sunColorForMember, sunPresetIdForMember } from "./memberSun";
export {
  GALAXY_PALETTES,
  circleAxisPosition,
  galaxyPaletteFor,
  sunAxisPosition,
} from "./galaxyPalette";
export type { GalaxyPalette, GalaxyPaletteId } from "./galaxyPalette";
export {
  clusterRingLegibility,
  clusterSlot,
  clusterSlots,
  clusterSystemScale,
} from "./systems/clusterLayout";

// ─── Categories and colour ───
export { GOAL_CATEGORIES, categoryBySlug } from "./categories";
export type { CategorySlug, GoalCategory } from "./categories";

// ─── Cosmetics, rolled once at goal creation and then stored ───
export {
  createGoalCosmeticsRoll,
  defaultBeltFor,
  PLANET_BELT_CHANCE,
  resolveBeltVisible,
  resolvePlanetRadius,
  resolveSurfaceKind,
  rollPlanetHasBelt,
} from "./planetCosmetics";
export { SURFACE_KINDS } from "./constants";

// ─── Achievements and ambience ───
export { achievementTier } from "./systems/starMilestones";
export {
  nextSkyAmbienceUnlockAt,
  SKY_AMBIENCE_TIER_LABELS,
  skyAmbienceProfileForTier,
  skyAmbienceTierFromCount,
} from "./systems/skyAmbienceProfile";
export type { SkyAmbienceProfile } from "./systems/skyAmbienceProfile";
export {
  achievementStarCount,
  placeAchievementStars,
} from "./stars";

// ─── Presets and onboarding-time colour choices ───
export {
  DEFAULT_SUN_COLOR,
  SUN_COLOR_PRESETS,
  isSunPresetId,
  sunPresetById,
} from "./palettes";
export type { ColorPreset, SunPresetId } from "./palettes";
export {
  applyOnboardingPrefs,
  createOnboardingSnapshot,
  DEFAULT_NEBULA_CATEGORY,
  nebulaColorsFromCategories,
  nebulaConfigFromPrefs,
  resolveNebulaColors,
  resolveNebulaConfig,
  resolveNebulaSeedColor,
  resolveSunColor,
} from "./onboarding";
export type { OnboardingColorPrefs } from "./onboarding";

// ─── Layout and hashing, exposed for hosts that need to agree with the scene ───
export { hashString, hashRange, mulberry32, pickIndex } from "./rng";
export { orbitRadiiForCount } from "./systems/orbitLayout";
export {
  nebulaConfigFromEntries,
  nebulaEntriesFromColors,
  nebulaPalette,
  pickWeightedColor,
} from "./systems/nebulaClusters";
export type { NebulaColorEntry } from "./systems/nebulaClusters";

// ─── Types ───
export type {
  BeltConfig,
  BeltMode,
  ColorHex,
  GalaxyCosmetics,
  GalaxyHandle,
  GalaxySnapshot,
  GoalCosmetics,
  MountOptions,
  NebulaConfig,
  PlanetConfig,
  SingleSystemSnapshot,
  StarConfig,
  SunConfig,
  SurfaceKind,
  SystemConfig,
  ViewRotation,
} from "./types";
