import { describe, expect, it } from "vitest";
import { SkyAmbience } from "./SkyAmbience";

describe("SkyAmbience", () => {
  it("spawns shooting stars over time when animated", () => {
    const layer = new SkyAmbience(42);
    layer.setTier(1);
    layer.layout(800, 600);
    let sawStreak = false;

    for (let step = 0; step < 40; step += 1) {
      layer.tick(250, true);
      const streaks = layer.container.getChildByLabel("shooting-stars", true);
      if (streaks && streaks.children.length > 0) {
        sawStreak = true;
      }
    }

    expect(sawStreak).toBe(true);
    layer.destroy();
  });

  it("clears streaks when disabled", () => {
    const layer = new SkyAmbience(7);
    layer.setTier(1);
    layer.layout(640, 480);
    for (let step = 0; step < 30; step += 1) {
      layer.tick(300, true);
    }
    layer.setEnabled(false);
    const streaks = layer.container.getChildByLabel("shooting-stars", true);
    expect(streaks?.children.length ?? 0).toBe(0);
    layer.destroy();
  });

  it("does not spawn while animation is off", () => {
    const layer = new SkyAmbience(9);
    layer.setTier(1);
    layer.layout(640, 480);
    layer.tick(10_000, false);
    const streaks = layer.container.getChildByLabel("shooting-stars", true);
    expect(streaks?.children.length ?? 0).toBe(0);
    layer.destroy();
  });

  it("shows asteroid field only at tier 3", () => {
    const low = new SkyAmbience(11);
    low.setTier(2);
    low.layout(640, 480);
    const lowField = low.container.getChildByLabel("asteroid-field", true);
    expect(lowField?.visible).toBe(false);

    const high = new SkyAmbience(11);
    high.setTier(3);
    high.layout(640, 480);
    const highField = high.container.getChildByLabel("asteroid-field", true);
    expect(highField?.visible).toBe(true);
    expect(highField?.children.length).toBeGreaterThan(0);

    low.destroy();
    high.destroy();
  });

  it("scales achieve burst streak count by tier", () => {
    const layer = new SkyAmbience(3);
    layer.setTier(0);
    layer.layout(400, 300);
    layer.spawnAchieveBurst(200, 150, 0);
    const streaks = layer.container.getChildByLabel("shooting-stars", true);
    expect(streaks?.children.length).toBe(4);

    layer.setTier(3);
    layer.spawnAchieveBurst(200, 150, 3);
    expect(streaks?.children.length).toBe(4 + 12);

    layer.destroy();
  });
});
