import { describe, expect, it } from "vitest";
import { ORBIT_SPIN_UP_MS } from "../constants";
import { orbitSpeedScale } from "./OrbitSystem";

describe("orbitSpeedScale", () => {
  it("starts at rest and eases to full speed", () => {
    expect(orbitSpeedScale(0)).toBe(0);
    expect(orbitSpeedScale(-40)).toBe(0);
    expect(orbitSpeedScale(ORBIT_SPIN_UP_MS / 2)).toBeGreaterThan(0.5);
    expect(orbitSpeedScale(ORBIT_SPIN_UP_MS / 2)).toBeLessThan(1);
    expect(orbitSpeedScale(ORBIT_SPIN_UP_MS)).toBe(1);
    expect(orbitSpeedScale(ORBIT_SPIN_UP_MS + 400)).toBe(1);
  });
});
