import { towardWhite } from "./color";
import { mulberry32 } from "./rng";
import type { ColorHex, StarConfig } from "./types";

const SURFACE_MARGIN = 0.04;

/** @deprecated Ring band kept for older tests; stars now fill the canvas. */
export const STAR_BAND = {
  inner: 0.38,
  outer: 0.48,
} as const;

/** Deterministic 1–3 stars per achievement from its seed. */
export const achievementStarCount = (seed: number): number =>
  1 + (seed % 3);

export const achievementStarTint = (
  color: ColorHex,
  random: () => number,
): ColorHex => towardWhite(color, 0.92 + random() * 0.07);

export const placeAchievementStars = (opts: {
  seed: number;
  color: ColorHex;
  count?: number;
}): StarConfig[] => {
  const random = mulberry32(opts.seed);
  const count = opts.count ?? achievementStarCount(opts.seed);
  const stars: StarConfig[] = [];
  for (let i = 0; i < count; i += 1) {
    const bright = random() > 0.82;
    stars.push({
      x: SURFACE_MARGIN + random() * (1 - SURFACE_MARGIN * 2),
      y: SURFACE_MARGIN + random() * (1 - SURFACE_MARGIN * 2),
      size: (bright ? 0.55 : 0.28) + random() * 0.42,
      twinkle: 0.1 + random() * 0.32,
      seed: random() * Math.PI * 2,
      color: achievementStarTint(opts.color, random),
    });
  }
  return stars;
};
