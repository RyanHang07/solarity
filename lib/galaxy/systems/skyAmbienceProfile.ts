import { ACHIEVEMENT_MILESTONE_STEP } from "../constants";
import { achievementTier } from "./starMilestones";

export type ShootingStarParams = {
  maxActive: number;
  minSpawnMs: number;
  maxSpawnMs: number;
};

export type AsteroidDriftParams = {
  maxActive: number;
  minSpawnMs: number;
  maxSpawnMs: number;
  speedMin: number;
  speedMax: number;
};

export type AsteroidFieldParams = {
  pebbleCount: number;
  bandCenterY: number;
  bandHeight: number;
};

export type AchieveBurstParams = {
  streakCount: number;
  rockScatter: boolean;
  ringStrength: number;
};

export type SkyAmbienceProfile = {
  shootingStars: ShootingStarParams;
  asteroidDrift: AsteroidDriftParams | null;
  asteroidField: AsteroidFieldParams | null;
  achieveBurst: AchieveBurstParams;
};

const TIER_PROFILES: readonly SkyAmbienceProfile[] = [
  {
    shootingStars: { maxActive: 3, minSpawnMs: 2800, maxSpawnMs: 7200 },
    asteroidDrift: null,
    asteroidField: null,
    achieveBurst: { streakCount: 4, rockScatter: false, ringStrength: 1 },
  },
  {
    shootingStars: { maxActive: 5, minSpawnMs: 1800, maxSpawnMs: 5200 },
    asteroidDrift: null,
    asteroidField: null,
    achieveBurst: { streakCount: 6, rockScatter: false, ringStrength: 1.15 },
  },
  {
    shootingStars: { maxActive: 6, minSpawnMs: 1400, maxSpawnMs: 4200 },
    asteroidDrift: {
      maxActive: 8,
      minSpawnMs: 3200,
      maxSpawnMs: 8200,
      speedMin: 0.06,
      speedMax: 0.16,
    },
    asteroidField: null,
    achieveBurst: { streakCount: 8, rockScatter: true, ringStrength: 1.3 },
  },
  {
    shootingStars: { maxActive: 7, minSpawnMs: 1200, maxSpawnMs: 3800 },
    asteroidDrift: {
      maxActive: 14,
      minSpawnMs: 2800,
      maxSpawnMs: 7200,
      speedMin: 0.07,
      speedMax: 0.18,
    },
    asteroidField: {
      pebbleCount: 32,
      bandCenterY: 0.38,
      bandHeight: 0.22,
    },
    achieveBurst: { streakCount: 12, rockScatter: true, ringStrength: 1.55 },
  },
];

export const SKY_AMBIENCE_TIER_LABELS: readonly {
  tier: number;
  minAchievements: number;
  title: string;
  description: string;
}[] = [
  {
    tier: 0,
    minAchievements: 0,
    title: "Quiet sky",
    description: "Rare shooting stars drift across the background.",
  },
  {
    tier: 1,
    minAchievements: ACHIEVEMENT_MILESTONE_STEP,
    title: "Streaking sky",
    description: "Shooting stars appear more often as your galaxy grows.",
  },
  {
    tier: 2,
    minAchievements: ACHIEVEMENT_MILESTONE_STEP * 2,
    title: "Asteroid drift",
    description: "Slow asteroid pebbles wander through the outer sky.",
  },
  {
    tier: 3,
    minAchievements: ACHIEVEMENT_MILESTONE_STEP * 3,
    title: "Asteroid field",
    description: "A distant asteroid band adds depth behind your Stars.",
  },
];

export const skyAmbienceTierFromCount = (count: number): number =>
  achievementTier(count);

export const skyAmbienceProfileForTier = (tier: number): SkyAmbienceProfile =>
  TIER_PROFILES[Math.min(3, Math.max(0, tier))] ?? TIER_PROFILES[0];

export const nextSkyAmbienceUnlockAt = (count: number): number | null => {
  const tier = achievementTier(count);
  if (tier >= 3) {
    return null;
  }
  return (tier + 1) * ACHIEVEMENT_MILESTONE_STEP;
};
