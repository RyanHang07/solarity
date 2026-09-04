import { onlySystem, singleSystemSnapshot } from "./singleSystem";
import { describe, expect, it } from "vitest";
import { categoryBySlug } from "./categories";
import { DEFAULT_SUN_COLOR, SUN_COLOR_PRESETS } from "./palettes";
import {
  applyOnboardingPrefs,
  createOnboardingSnapshot,
  DEFAULT_NEBULA_CATEGORY,
  nebulaColorsFromCategories,
  resolveNebulaColors,
  resolveNebulaSeedColor,
  resolveSunColor,
} from "./onboarding";

describe("onboarding color prefs", () => {
  it("exposes six distinct sun presets", () => {
    expect(SUN_COLOR_PRESETS).toHaveLength(6);
    expect(new Set(SUN_COLOR_PRESETS.map((preset) => preset.color)).size).toBe(6);
    expect(SUN_COLOR_PRESETS.some((preset) => preset.id === "azure")).toBe(true);
  });

  it("resolves sun color from preset id or explicit hex", () => {
    expect(resolveSunColor({ sunPresetId: "gold" })).toBe(0xffc107);
    expect(resolveSunColor({ sunColor: 0x112233 })).toBe(0x112233);
    expect(resolveSunColor({})).toBe(DEFAULT_SUN_COLOR);
  });

  it("resolves nebula seed from goal category slug", () => {
    expect(resolveNebulaSeedColor({ nebulaCategorySlug: "finances" })).toBe(
      categoryBySlug("finances").color,
    );
    expect(resolveNebulaSeedColor({})).toBe(
      categoryBySlug(DEFAULT_NEBULA_CATEGORY).color,
    );
  });

  it("blends seed and achievement colors during preview", () => {
    const fitness = categoryBySlug("fitness").color;
    const mindfulness = categoryBySlug("mindfulness").color;
    expect(
      resolveNebulaColors(
        { nebulaCategorySlug: "mindfulness" },
        { achievementColors: [fitness], preview: true },
      ),
    ).toEqual([mindfulness, fitness]);
  });

  it("builds an onboarding snapshot with preview nebula", () => {
    const snapshot = createOnboardingSnapshot({
      sunPresetId: "ember",
      nebulaCategorySlug: "mindfulness",
    });
    expect(onlySystem(snapshot).planets).toEqual([]);
    expect(onlySystem(snapshot).sun.color).toBe(0xff4520);
    expect(snapshot.nebula?.colors).toEqual([categoryBySlug("mindfulness").color]);
    expect(snapshot.nebulaPreview).toBe(true);
  });

  it("uses achievement goal colors and weights once preview unlocks", () => {
    const fitness = categoryBySlug("fitness").color;
    const productivity = categoryBySlug("productivity").color;
    const merged = applyOnboardingPrefs(
      singleSystemSnapshot({
        sun: { color: DEFAULT_SUN_COLOR, radius: 28 },
        planets: [],
        stars: [{ x: 0.5, y: 0.5, size: 1, twinkle: 0.2, seed: 1, color: fitness }],
        nebula: { colors: [fitness, productivity], alpha: 0.2 },
      }),
      { nebulaCategorySlug: "mindfulness" },
      { achievementColors: [fitness, productivity, fitness], preview: false },
    );
    expect(merged.nebula?.colors).toEqual([fitness, productivity]);
    expect(merged.nebula?.weights).toEqual([2, 1]);
  });

  it("dedupes nebula colors from category slugs", () => {
    expect(
      nebulaColorsFromCategories(["fitness", "fitness", "health"]),
    ).toEqual([
      categoryBySlug("fitness").color,
      categoryBySlug("health").color,
    ]);
  });
});
