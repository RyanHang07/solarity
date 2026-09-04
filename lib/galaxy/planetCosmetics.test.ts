import { describe, expect, it } from "vitest";
import {
  PLANET_BELT_CHANCE,
  createGoalCosmeticsRoll,
  defaultBeltFor,
  resolveBeltVisible,
  rollPlanetHasBelt,
} from "./planetCosmetics";

describe("planetCosmetics", () => {
  it("uses a one-in-five belt chance", () => {
    expect(PLANET_BELT_CHANCE).toBe(0.2);
    expect(rollPlanetHasBelt(() => 0)).toBe(true);
    expect(rollPlanetHasBelt(() => 0.19)).toBe(true);
    expect(rollPlanetHasBelt(() => 0.2)).toBe(false);
    expect(rollPlanetHasBelt(() => 0.99)).toBe(false);
  });

  it("builds a default Saturn belt from planet radius", () => {
    expect(defaultBeltFor(10, 0xff0000)).toEqual({
      color: 0xff0000,
      innerRadius: 24,
      outerRadius: 36,
    });
  });

  it("resolves belt visibility from mode", () => {
    expect(resolveBeltVisible({ beltMode: "on" })).toBe(true);
    expect(resolveBeltVisible({ beltMode: "off" })).toBe(false);
    expect(
      resolveBeltVisible({ beltMode: "auto", beltVisible: true }),
    ).toBe(true);
  });

  it("rolls goal cosmetics for insert", () => {
    const row = createGoalCosmeticsRoll();
    expect(row.beltMode).toBe("auto");
    expect(typeof row.beltVisible).toBe("boolean");
  });
});
