import { categoryBySlug, type CategorySlug } from "./categories";
import { NEBULA_MIN_CATEGORIES } from "./constants";
import { nebulaConfigFromPrefs } from "./onboarding";
import {
  defaultBeltFor,
  resolveBeltVisible,
  resolvePlanetRadius,
  resolveSurfaceKind,
} from "./planetCosmetics";
import { hashRange, hashString } from "./rng";
import { singleSystemSnapshot } from "./singleSystem";
import { placeAchievementStars } from "./stars";
import type {
  GalaxyCosmetics,
  GalaxySnapshot,
  GoalCosmetics,
  PlanetConfig,
} from "./types";
import { orbitRadiiForCount } from "./systems/orbitLayout";
import { resolveSunColor } from "./onboarding";

export type SnapshotGoal = {
  id: string;
  categorySlug: CategorySlug;
  shine: boolean;
  phase?: number;
  orbitSpeed?: number;
  radius?: number;
};

export type SnapshotAchievement = {
  id: string;
  categorySlug: CategorySlug;
};

export type BuildGalaxySnapshotInput = {
  goals: readonly SnapshotGoal[];
  achievements: readonly SnapshotAchievement[];
  cosmetics: GalaxyCosmetics;
  goalCosmeticsById?: Readonly<Record<string, GoalCosmetics>>;
  dayClosed?: boolean;
  sunRadius?: number;
  sunGrowth?: number;
};

const seedFromId = (id: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
};

// `hashRange`, not `% 628`: 628 is divisible by four, and an FNV-1a hash's low
// bits are barely mixed, so this reached 157 of its 628 values. Invisible in a
// phase, but the same trap that made half the planet surfaces unreachable.
const defaultPhase = (id: string): number =>
  hashRange(hashString(id), 628) / 100;

const defaultOrbitSpeed = (id: string, index: number): number =>
  0.12 + (index % 5) * 0.08 + hashRange(hashString(id), 40) / 500;

const defaultRadius = (index: number): number =>
  12 + (index % 4) * 2;

export const buildGalaxySnapshot = (
  input: BuildGalaxySnapshotInput,
): GalaxySnapshot => {
  const {
    goals,
    achievements,
    cosmetics,
    goalCosmeticsById = {},
    dayClosed,
    sunRadius = 28,
    sunGrowth = 0.15,
  } = input;

  const achievementColors = achievements.map(
    (item) => categoryBySlug(item.categorySlug).color,
  );
  const uniqueFamilies = new Set(achievementColors).size;
  const previewByProgress = uniqueFamilies < NEBULA_MIN_CATEGORIES;
  const nebulaPreview =
    Boolean(cosmetics.nebulaPreview) && previewByProgress;
  const nebula =
    nebulaPreview || achievementColors.length > 0
      ? nebulaConfigFromPrefs(
          {
            sunPresetId: cosmetics.sunPresetId,
            nebulaCategorySlug: cosmetics.nebulaCategorySlug,
            nebulaPreview: cosmetics.nebulaPreview,
          },
          { achievementColors, preview: nebulaPreview },
        )
      : undefined;

  const orbitRadii = orbitRadiiForCount(goals.length);
  const planets: PlanetConfig[] = goals.map((goal, index) => {
    const merged: GoalCosmetics = {
      ...cosmetics.defaults,
      ...goalCosmeticsById[goal.id],
    };
    const category = categoryBySlug(goal.categorySlug);
    const radius =
      goal.radius ??
      resolvePlanetRadius(merged) ??
      defaultRadius(index);
    const beltVisible = resolveBeltVisible(merged);
    const visualSeed = merged.visualSeed ?? seedFromId(goal.id);
    return {
      id: goal.id,
      color: category.color,
      radius,
      orbitRadius: orbitRadii[index] ?? radius * 8,
      orbitSpeed: goal.orbitSpeed ?? defaultOrbitSpeed(goal.id, index),
      phase: goal.phase ?? defaultPhase(goal.id),
      shine: goal.shine,
      belt: defaultBeltFor(radius, category.color),
      beltVisible,
      surfaceKind: resolveSurfaceKind(merged, goal.id),
      visualSeed,
    };
  });

  const stars = achievements.flatMap((item) =>
    placeAchievementStars({
      seed: seedFromId(item.id),
      color: categoryBySlug(item.categorySlug).color,
    }),
  );

  /**
   * **Through `singleSystemSnapshot`, not by hand.** This builder describes one
   * person, so it produces the one-element case rather than assembling a
   * `systems` array itself — which keeps exactly one place in the module that
   * knows what a personal galaxy's system id is.
   */
  return singleSystemSnapshot({
    sun: {
      color: resolveSunColor({ sunPresetId: cosmetics.sunPresetId }),
      radius: sunRadius,
      growth: sunGrowth,
    },
    planets,
    stars,
    achievementCount: achievements.length,
    nebula,
    nebulaPreview,
    dayClosed:
      dayClosed ??
      (goals.length > 0 && goals.every((goal) => goal.shine)),
  });
};
