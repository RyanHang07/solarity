import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_MILESTONE_STEP } from "../constants";
import {
  SKY_AMBIENCE_TIER_LABELS,
  nextSkyAmbienceUnlockAt,
  skyAmbienceProfileForTier,
  skyAmbienceTierFromCount,
} from "./skyAmbienceProfile";

describe("skyAmbienceProfile", () => {
  it("maps achievement counts to tiers every 5 achievements", () => {
    expect(skyAmbienceTierFromCount(4)).toBe(0);
    expect(skyAmbienceTierFromCount(5)).toBe(1);
    expect(skyAmbienceTierFromCount(6)).toBe(1);
    expect(skyAmbienceTierFromCount(10)).toBe(2);
    expect(skyAmbienceTierFromCount(15)).toBe(3);
    expect(skyAmbienceTierFromCount(99)).toBe(3);
  });

  it("returns distinct profiles per tier", () => {
    const tier0 = skyAmbienceProfileForTier(0);
    const tier1 = skyAmbienceProfileForTier(1);
    const tier2 = skyAmbienceProfileForTier(2);
    const tier3 = skyAmbienceProfileForTier(3);

    expect(tier0.shootingStars.maxActive).toBeLessThan(tier1.shootingStars.maxActive);
    expect(tier1.asteroidDrift).toBeNull();
    expect(tier2.asteroidDrift).not.toBeNull();
    expect(tier2.asteroidField).toBeNull();
    expect(tier3.asteroidField).not.toBeNull();
    expect(tier3.achieveBurst.streakCount).toBeGreaterThan(tier0.achieveBurst.streakCount);
  });

  it("exposes tier labels aligned to milestone step", () => {
    expect(SKY_AMBIENCE_TIER_LABELS).toHaveLength(4);
    expect(SKY_AMBIENCE_TIER_LABELS[1]?.minAchievements).toBe(
      ACHIEVEMENT_MILESTONE_STEP,
    );
  });

  it("reports next unlock threshold", () => {
    expect(nextSkyAmbienceUnlockAt(0)).toBe(ACHIEVEMENT_MILESTONE_STEP);
    expect(nextSkyAmbienceUnlockAt(5)).toBe(ACHIEVEMENT_MILESTONE_STEP * 2);
    expect(nextSkyAmbienceUnlockAt(15)).toBeNull();
  });
});
