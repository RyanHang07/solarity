import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_MILESTONE_STEP,
  STARS_PER_ACHIEVEMENT_MAX,
  STARS_PER_ACHIEVEMENT_MIN,
} from "./constants";
import {
  achievementStarCount,
  achievementStarTint,
  placeAchievementStars,
} from "./stars";
import {
  achievementTier,
  milestoneNebulaAlpha,
  milestoneTwinkleBoost,
} from "./systems/starMilestones";

describe("placeAchievementStars", () => {
  it("scatters across the full canvas instead of a ring band", () => {
    const stars = placeAchievementStars({ seed: 42, color: 0xff8866 });
    for (const star of stars) {
      expect(star.x).toBeGreaterThanOrEqual(0.04);
      expect(star.x).toBeLessThanOrEqual(0.96);
      expect(star.y).toBeGreaterThanOrEqual(0.04);
      expect(star.y).toBeLessThanOrEqual(0.96);
    }
  });

  it("adds 1–3 stars per achievement from the seed", () => {
    const counts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) =>
        placeAchievementStars({ seed, color: 0xff8866 }).length,
      ),
    );
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(STARS_PER_ACHIEVEMENT_MIN);
      expect(count).toBeLessThanOrEqual(STARS_PER_ACHIEVEMENT_MAX);
    }
    expect(achievementStarCount(3)).toBe(1);
    expect(achievementStarCount(4)).toBe(2);
    expect(achievementStarCount(5)).toBe(3);
  });

  it("tints stars mostly white with a faint category hue", () => {
    const stars = placeAchievementStars({ seed: 9, color: 0xff2200 });
    for (const star of stars) {
      expect(star.color).toBeGreaterThan(0xf0f0f0);
      expect(star.color).not.toBe(0xff2200);
    }
    expect(achievementStarTint(0xff2200, () => 0.5)).toBeGreaterThan(0xf5f5f5);
  });
});

describe("achievementTier", () => {
  it("unlocks a new tier every milestone step", () => {
    expect(achievementTier(0)).toBe(0);
    expect(achievementTier(ACHIEVEMENT_MILESTONE_STEP - 1)).toBe(0);
    expect(achievementTier(ACHIEVEMENT_MILESTONE_STEP)).toBe(1);
    expect(achievementTier(ACHIEVEMENT_MILESTONE_STEP * 3)).toBe(3);
  });

  it("ramps nebula and twinkle effects with tier", () => {
    expect(milestoneNebulaAlpha(0)).toBeCloseTo(0.2);
    expect(milestoneNebulaAlpha(2)).toBeGreaterThan(milestoneNebulaAlpha(0));
    expect(milestoneTwinkleBoost(2)).toBeGreaterThan(milestoneTwinkleBoost(0));
  });
});
