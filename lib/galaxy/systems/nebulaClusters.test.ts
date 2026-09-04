import { describe, expect, it } from "vitest";
import { GOAL_CATEGORIES } from "../categories";
import { NEBULA_STAMP_COUNT } from "../constants";
import { placeAchievementStars } from "../stars";
import {
  nebulaEntriesFromColors,
  nebulaPalette,
  nebulaSignature,
  nebulaUnlocked,
  pickWeightedColor,
  placeNebulaLobes,
  placeNebulaStamps,
  uniqueColorFamilies,
} from "./nebulaClusters";
import { mulberry32 } from "../rng";

describe("nebulaClusters", () => {
  it("blends categories into one palette instead of one lobe each", () => {
    const colors = GOAL_CATEGORIES.slice(0, 5).map((category) => category.color);
    const palette = nebulaPalette(colors);
    expect(palette.length).toBeGreaterThanOrEqual(3);
    expect(palette.length).toBeLessThanOrEqual(5);
    const stamps = placeNebulaStamps(colors, 12345, NEBULA_STAMP_COUNT, [1, 1, 1, 1, 1]);
    expect(stamps.length).toBe(NEBULA_STAMP_COUNT);
  });

  it("rings multi-color lobes around the system center", () => {
    const stars = [
      ...placeAchievementStars({ seed: 1, color: 0xff3131 }),
      ...placeAchievementStars({ seed: 2, color: 0x1ec8ff }),
    ];
    const lobes = placeNebulaLobes(stars);
    expect(lobes.length).toBeGreaterThanOrEqual(3);
    const meanX =
      lobes.reduce((sum, lobe) => sum + lobe.x, 0) / lobes.length;
    const meanY =
      lobes.reduce((sum, lobe) => sum + lobe.y, 0) / lobes.length;
    expect(meanX).toBeCloseTo(0, 1);
    expect(meanY).toBeCloseTo(0, 1);
  });

  it("stays locked until five families unless preview", () => {
    const few = placeAchievementStars({ seed: 3, color: 0xff3131 });
    expect(nebulaUnlocked(few, false)).toBe(false);
    expect(nebulaUnlocked(few, true)).toBe(true);
    const many = GOAL_CATEGORIES.slice(0, 5).flatMap((category, index) =>
      placeAchievementStars({ seed: 10 + index, color: category.color }),
    );
    expect(uniqueColorFamilies(many).length).toBeGreaterThanOrEqual(1);
    expect(
      nebulaUnlocked(many, false, {
        colors: GOAL_CATEGORIES.slice(0, 5).map((c) => c.color),
        alpha: 0.2,
      }),
    ).toBe(true);
  });

  it("changes signature when achievement weight per family grows", () => {
    const colors = [0xff3131];
    const first = placeAchievementStars({ seed: 4, color: 0xff3131 });
    const extra = [
      ...first,
      ...placeAchievementStars({ seed: 5, color: 0xff3131 }),
    ];
    const opts = {
      preview: true,
      reach: 380,
      nebula: { colors, weights: [1], alpha: 0.2 },
    };
    expect(nebulaSignature({ ...opts, stars: first })).not.toBe(
      nebulaSignature({
        ...opts,
        nebula: { colors, weights: [2], alpha: 0.2 },
        stars: extra,
      }),
    );
  });

  it("changes signature when a new family appears", () => {
    const opts = { preview: true, reach: 380, nebula: { colors: [0xff3131], weights: [1], alpha: 0.2 } };
    const one = placeAchievementStars({ seed: 6, color: 0xff3131 });
    const two = [
      ...one,
      ...placeAchievementStars({ seed: 7, color: 0x1ec8ff }),
    ];
    expect(
      nebulaSignature({ ...opts, stars: one }),
    ).not.toBe(
      nebulaSignature({
        ...opts,
        nebula: { colors: [0xff3131, 0x1ec8ff], weights: [1, 1], alpha: 0.2 },
        stars: two,
      }),
    );
  });

  it("randomizes stamp layout per session seed", () => {
    const colors = [0xff3131, 0x1ec8ff];
    const a = placeNebulaStamps(colors, 111, NEBULA_STAMP_COUNT, [1, 1]);
    const b = placeNebulaStamps(colors, 222, NEBULA_STAMP_COUNT, [1, 1]);
    expect(a[0]?.x).not.toBe(b[0]?.x);
  });

  it("weights stamp tints toward dominant achievement colors", () => {
    const colors = [0xff3131, 0x1ec8ff];
    const weights = [5, 1];
    const random = mulberry32(42);
    let red = 0;
    for (let i = 0; i < 200; i += 1) {
      if (pickWeightedColor(colors, weights, random) === 0xff3131) {
        red += 1;
      }
    }
    expect(red).toBeGreaterThan(120);
  });

  it("aggregates duplicate colors into nebula entries", () => {
    const entries = nebulaEntriesFromColors([
      0xff3131,
      0xff3131,
      0x1ec8ff,
    ]);
    expect(entries).toEqual([
      { color: 0xff3131, weight: 2 },
      { color: 0x1ec8ff, weight: 1 },
    ]);
  });
});
