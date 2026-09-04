import { categoryBySlug, type CategorySlug } from "./categories";
import { NEBULA_MIN_CATEGORIES } from "./constants";
import {
  nebulaConfigFromEntries,
  nebulaEntriesFromColors,
} from "./systems/nebulaClusters";
import { DEFAULT_SUN_COLOR, sunPresetById } from "./palettes";
import { onlySystem, singleSystemSnapshot } from "./singleSystem";
import type { ColorHex, GalaxySnapshot, NebulaConfig } from "./types";

/** Default first nebula tint before achievements — mindfulness purple. */
export const DEFAULT_NEBULA_CATEGORY: CategorySlug = "mindfulness";

export type OnboardingColorPrefs = {
  sunPresetId?: string;
  sunColor?: ColorHex;
  /** Goal category whose color seeds the nebula during onboarding. */
  nebulaCategorySlug?: CategorySlug;
  nebulaColor?: ColorHex;
  /** Show nebula from seed color before five achievement families exist. */
  nebulaPreview?: boolean;
};

export type ResolveNebulaColorsOpts = {
  /** Include duplicates — one entry per achieved goal for weighting. */
  achievementColors?: readonly ColorHex[];
  /** Host preview — picker drives nebula until five goal-color families unlock it. */
  preview?: boolean;
};

export const resolveSunColor = (prefs: OnboardingColorPrefs): ColorHex => {
  if (prefs.sunColor !== undefined) {
    return prefs.sunColor;
  }
  if (prefs.sunPresetId) {
    return sunPresetById(prefs.sunPresetId)?.color ?? DEFAULT_SUN_COLOR;
  }
  return DEFAULT_SUN_COLOR;
};

export const resolveNebulaSeedColor = (prefs: OnboardingColorPrefs): ColorHex => {
  if (prefs.nebulaColor !== undefined) {
    return prefs.nebulaColor;
  }
  const slug = prefs.nebulaCategorySlug ?? DEFAULT_NEBULA_CATEGORY;
  return categoryBySlug(slug).color;
};

/** Unique goal category colors for nebula blending. */
export const nebulaColorsFromCategories = (
  slugs: readonly CategorySlug[],
): ColorHex[] => [
  ...new Set(slugs.map((slug) => categoryBySlug(slug).color)),
];

export const resolveNebulaColors = (
  prefs: OnboardingColorPrefs,
  opts: ResolveNebulaColorsOpts = {},
): ColorHex[] => resolveNebulaConfig(prefs, opts).colors;

export const resolveNebulaConfig = (
  prefs: OnboardingColorPrefs,
  opts: ResolveNebulaColorsOpts = {},
): NebulaConfig => {
  const seed = resolveNebulaSeedColor(prefs);
  const achievementColors = opts.achievementColors ?? [];
  const uniqueFamilies = new Set(achievementColors).size;
  const previewActive =
    Boolean(opts.preview) && uniqueFamilies < NEBULA_MIN_CATEGORIES;

  if (previewActive) {
    if (achievementColors.length === 0) {
      return { colors: [seed], weights: [1], alpha: 0.22 };
    }
    const seedWeight = Math.max(1, NEBULA_MIN_CATEGORIES - uniqueFamilies);
    return nebulaConfigFromEntries(
      [
        { color: seed, weight: seedWeight },
        ...nebulaEntriesFromColors(achievementColors),
      ],
      0.22,
    );
  }
  if (achievementColors.length > 0) {
    return nebulaConfigFromEntries(
      nebulaEntriesFromColors(achievementColors),
      0.22,
    );
  }
  return { colors: [seed], weights: [1], alpha: 0.22 };
};

export const nebulaConfigFromPrefs = (
  prefs: OnboardingColorPrefs,
  opts: ResolveNebulaColorsOpts = {},
): NebulaConfig => resolveNebulaConfig(prefs, opts);

/** Empty galaxy for onboarding — Sun + one goal-color nebula only. */
export const createOnboardingSnapshot = (
  prefs: OnboardingColorPrefs,
): GalaxySnapshot =>
  singleSystemSnapshot({
    sun: {
      color: resolveSunColor(prefs),
      radius: 28,
      growth: 0.15,
    },
    planets: [],
    stars: [],
    nebula: nebulaConfigFromPrefs(prefs, { preview: true }),
    nebulaPreview: prefs.nebulaPreview ?? true,
    achievementCount: 0,
    dayClosed: false,
  });

/** Apply onboarding picks onto an existing snapshot (e.g. after first goal added). */
export const applyOnboardingPrefs = (
  snapshot: GalaxySnapshot,
  prefs: OnboardingColorPrefs,
  opts: ResolveNebulaColorsOpts = {},
): GalaxySnapshot => {
  /**
   * **Onboarding is single-system by construction**, so this recolours the one
   * sun there is. `onlySystem` throws rather than shrugging: an onboarding
   * snapshot with no system is a bug in the caller, and a silent no-op here
   * would surface as a sun that ignored the colour somebody just picked.
   */
  const system = onlySystem(snapshot);
  return {
    ...snapshot,
    systems: [
      {
        ...system,
        sun: { ...system.sun, color: resolveSunColor(prefs) },
      },
      ...snapshot.systems.slice(1),
    ],
    nebula: nebulaConfigFromPrefs(prefs, opts),
    nebulaPreview:
      prefs.nebulaPreview ??
      snapshot.nebulaPreview ??
      (snapshot.stars.length < NEBULA_MIN_CATEGORIES &&
        Boolean(snapshot.nebula?.colors.length)),
  };
};
