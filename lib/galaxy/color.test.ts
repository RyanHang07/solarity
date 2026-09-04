import { describe, expect, it } from "vitest";
import { relativeLuminance, rotateHue, sunGlowBoost, sunRadianceTint } from "./color";

describe("rotateHue", () => {
  it("shifts a saturated color to a different hue", () => {
    const from = 0xff3131;
    const to = rotateHue(from, 150);
    expect(to).not.toBe(from);
    const fromR = (from >> 16) & 0xff;
    const toR = (to >> 16) & 0xff;
    const toG = (to >> 8) & 0xff;
    expect(toR).toBeLessThan(fromR);
    expect(toG).toBeGreaterThan(80);
  });
});

describe("sun radiance normalization", () => {
  it("lifts low-luminance presets without changing bright ones", () => {
    const ember = 0xff4520;
    const rose = 0xff2d6a;
    expect(relativeLuminance(sunRadianceTint(ember))).toBeGreaterThan(
      relativeLuminance(ember),
    );
    expect(relativeLuminance(sunRadianceTint(rose))).toBeGreaterThan(
      relativeLuminance(rose),
    );
    expect(sunRadianceTint(0xfff8f0)).toBe(0xfff8f0);
  });

  it("boosts glow for darker Sun colors", () => {
    expect(sunGlowBoost(0xff4520)).toBeGreaterThan(1);
    expect(sunGlowBoost(0xfff8f0)).toBe(1);
  });
});
