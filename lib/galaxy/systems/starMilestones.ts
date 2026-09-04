import { ACHIEVEMENT_MILESTONE_STEP } from "../constants";

export const achievementTier = (count: number): number =>
  Math.min(3, Math.floor(Math.max(0, count) / ACHIEVEMENT_MILESTONE_STEP));

export const milestoneNebulaAlpha = (tier: number, base = 0.2): number =>
  base * (1 + tier * 0.1);

export const milestoneTwinkleBoost = (tier: number): number => {
  if (tier >= 3) {
    return 0.16;
  }
  if (tier >= 2) {
    return 0.1;
  }
  if (tier >= 1) {
    return 0.05;
  }
  return 0;
};

export const milestoneSunPulse = (tier: number): number =>
  tier >= 2 ? 0.08 : tier >= 1 ? 0.04 : 0;
