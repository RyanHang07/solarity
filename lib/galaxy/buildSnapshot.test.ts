import { describe, expect, it } from "vitest";
import { buildGalaxySnapshot } from "./buildSnapshot";
import { onlySystem } from "./singleSystem";
import { resolveSunColor } from "./onboarding";
import { SURFACE_KINDS } from "./render/planetTexture";

describe("buildGalaxySnapshot", () => {
  it("maps galaxy cosmetics and per-goal belt modes", () => {
    const snapshot = buildGalaxySnapshot({
      goals: [
        {
          id: "focus",
          categorySlug: "productivity",
          shine: true,
          radius: 14,
        },
        {
          id: "health",
          categorySlug: "health",
          shine: false,
        },
      ],
      achievements: [{ id: "a1", categorySlug: "fitness" }],
      cosmetics: {
        sunPresetId: "amber",
        nebulaCategorySlug: "mindfulness",
        nebulaPreview: true,
      },
      goalCosmeticsById: {
        focus: { beltMode: "on" },
        health: { beltMode: "off" },
      },
    });

    expect(onlySystem(snapshot).sun.color).toBe(resolveSunColor({ sunPresetId: "amber" }));
    expect(onlySystem(snapshot).planets.find((planet) => planet.id === "focus")?.beltVisible).toBe(
      true,
    );
    expect(onlySystem(snapshot).planets.find((planet) => planet.id === "health")?.beltVisible).toBe(
      false,
    );
    expect(onlySystem(snapshot).dayClosed).toBe(false);
    expect(snapshot.stars.length).toBeGreaterThan(0);
  });

  it("honors explicit surface kind and clamps planet radius", () => {
    const snapshot = buildGalaxySnapshot({
      goals: [{ id: "craft", categorySlug: "hobbies", shine: false }],
      achievements: [],
      cosmetics: {},
      goalCosmeticsById: {
        craft: { surfaceKind: "ice", planetRadius: 99 },
      },
    });

    const planet = onlySystem(snapshot).planets[0];
    expect(planet?.surfaceKind).toBe("ice");
    expect(planet?.radius).toBe(20);
  });

  it("seeds surface kind from goal id when unset", () => {
    const snapshot = buildGalaxySnapshot({
      goals: [{ id: "rest", categorySlug: "mindfulness", shine: false }],
      achievements: [],
      cosmetics: {},
    });

    expect(SURFACE_KINDS).toContain(onlySystem(snapshot).planets[0]?.surfaceKind);
  });
});
