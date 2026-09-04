import type { BeltConfig, ColorHex, GoalCosmetics, SurfaceKind } from "./types";
import { hashString, pickIndex } from "./rng";
import { SURFACE_KINDS } from "./constants";

/** Independent roll when a new Ring (goal) is created. */
export const PLANET_BELT_CHANCE = 1 / 5;

export const rollPlanetHasBelt = (
  random: () => number = Math.random,
): boolean => random() < PLANET_BELT_CHANCE;

export const defaultBeltFor = (
  planetRadius: number,
  color: ColorHex,
): BeltConfig => ({
  color,
  innerRadius: Math.round(planetRadius * 2.4),
  outerRadius: Math.round(planetRadius * 2.4) + 12,
});

/** Call once when inserting a goal row in Solarity. */
export const createGoalCosmeticsRoll = (): GoalCosmetics => ({
  beltMode: "auto",
  beltVisible: rollPlanetHasBelt(),
});

export const resolveBeltVisible = (cosmetics?: GoalCosmetics): boolean => {
  if (!cosmetics) {
    return false;
  }
  if (cosmetics.beltMode === "on") {
    return true;
  }
  if (cosmetics.beltMode === "off") {
    return false;
  }
  return cosmetics.beltVisible ?? false;
};

export const resolvePlanetRadius = (
  cosmetics: GoalCosmetics | undefined,
): number | undefined => {
  if (cosmetics?.planetRadius === undefined) {
    return undefined;
  }
  return Math.min(20, Math.max(10, cosmetics.planetRadius));
};

export const resolveSurfaceKind = (
  cosmetics: GoalCosmetics | undefined,
  goalId: string,
): SurfaceKind => {
  if (cosmetics?.surfaceKind) {
    return cosmetics.surfaceKind;
  }
  const seed = cosmetics?.visualSeed ?? hashString(goalId);
  // `pickIndex`, not `% 6` — see `rng.ts`. Six surfaces and an even modulus
  // over an FNV-1a hash reaches only three of them.
  return (
    SURFACE_KINDS[pickIndex(seed, SURFACE_KINDS.length)] ??
    SURFACE_KINDS[0] ??
    "terra"
  );
};
